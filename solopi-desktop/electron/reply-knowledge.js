const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const mammoth = require('mammoth');
const yauzl = require('yauzl');

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2048;
const ID = /^[a-f0-9]{32}$/;

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function readImportFile(filePath) {
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw failure('invalid_file');
    if (stat.size > MAX_FILE_BYTES) throw failure('file_too_large');
    const data = await handle.readFile();
    if (data.length > MAX_FILE_BYTES) throw failure('file_too_large');
    return data;
  } finally {
    await handle.close();
  }
}

function checkDocx(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(failure('invalid_docx'));
      let entries = 0;
      let expanded = 0;
      let content = false;
      let finished = false;
      const fail = (code) => {
        if (finished) return;
        finished = true;
        zip.close();
        reject(failure(code));
      };
      zip.on('error', () => fail('invalid_docx'));
      zip.on('entry', (entry) => {
        entries += 1;
        expanded += entry.uncompressedSize;
        if (entries > MAX_ZIP_ENTRIES || expanded > MAX_ZIP_BYTES) return fail('file_too_large');
        if (entry.fileName === 'word/document.xml') content = true;
        if (!/\.(xml|rels)$/i.test(entry.fileName)) return zip.readEntry();
        // Code security: inspect XML before the document parser sees it.
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail('invalid_docx');
          let size = 0;
          const parts = [];
          stream.on('data', (part) => {
            size += part.length;
            if (size > MAX_ZIP_BYTES) { stream.destroy(); return fail('file_too_large'); }
            parts.push(part);
          });
          stream.on('error', () => fail('invalid_docx'));
          stream.on('end', () => {
            const xml = Buffer.concat(parts);
            if (xml.includes(0) || /<!DOCTYPE/i.test(xml.toString('utf8'))) return fail('invalid_docx');
            if (!finished) zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (finished) return;
        finished = true;
        if (!content) return reject(failure('invalid_docx'));
        resolve();
      });
      zip.readEntry();
    });
  });
}

async function extractPdf(buffer) {
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw failure('invalid_pdf');
  let document;
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    document = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, maxImageSize: 1, verbosity: 0 }).promise;
    if (document.numPages > 100) throw failure('too_many_pages');
    let result = '';
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      result += `${content.items.map((item) => item.str || '').join(' ')}\n`;
      page.cleanup();
      if (result.length > MAX_TEXT_CHARS) throw failure('text_too_large');
    }
    return result;
  } catch (error) {
    if (error.code) throw error;
    throw failure('invalid_or_encrypted_pdf');
  } finally {
    if (document) await document.destroy();
  }
}

async function extractFile(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      if (text.includes('\0')) throw failure('invalid_text_encoding');
      return text;
    }
    catch { throw failure('invalid_text_encoding'); }
  }
  if (ext === '.pdf') return extractPdf(buffer);
  if (ext === '.docx') {
    await checkDocx(buffer);
    try { return (await mammoth.extractRawText({ buffer })).value; }
    catch { throw failure('invalid_docx'); }
  }
  throw failure('unsupported_file_type');
}

function tokens(value) {
  const normalized = value.normalize('NFKC').toLowerCase();
  const found = new Set(normalized.match(/[a-z0-9]+/g) || []);
  for (const match of normalized.matchAll(/[\u3400-\u9fff]+/g)) {
    const text = match[0];
    if (text.length === 1) found.add(text);
    else for (let i = 0; i < text.length - 1; i += 1) found.add(text.slice(i, i + 2));
  }
  return [...found];
}

function chunks(text) {
  const result = [];
  const latin = (character) => !!character && /^[a-z0-9]+$/i.test(character.normalize('NFKC'));
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 500, text.length);
    // Keep Latin words whole and retain the Chinese bigram at a chunk boundary.
    if (latin(text[end - 1]) && latin(text[end])) {
      let wordStart = end;
      while (wordStart > start && latin(text[wordStart - 1])) wordStart -= 1;
      if (wordStart > start) end = wordStart;
      else while (end < text.length && latin(text[end])) end += 1;
    }
    result.push(text.slice(start, end));
    start = end < text.length && /[\u3400-\u9fff]/.test(text[end - 1]) && /[\u3400-\u9fff]/.test(text[end]) ? end - 1 : end;
  }
  return result;
}

function createKnowledgeStore({ directory }) {
  if (!path.isAbsolute(directory)) throw failure('invalid_directory');
  const ensureDirectory = async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // Code security: private records must not be reached via a symlink or shared directory.
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('unsafe_directory');
    if (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) throw failure('unsafe_directory');
  };
  const fileFor = (id) => {
    // Code security: records use generated IDs and cannot escape the private directory.
    if (!ID.test(id)) throw failure('invalid_id');
    return path.join(directory, `${id}.json`);
  };
  async function records() {
    await ensureDirectory();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      if (!/^[a-f0-9]{32}\.json$/.test(entry.name)) continue;
      const id = entry.name.slice(0, -5);
      try {
        if (!entry.isFile()) throw failure('invalid_record');
        const handle = await fs.open(path.join(directory, entry.name), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        let raw;
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > MAX_TEXT_CHARS * 4 + 4096 || (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) throw failure('invalid_record');
          raw = await handle.readFile('utf8');
        } finally { await handle.close(); }
        const doc = JSON.parse(raw);
        if (!doc || doc.id !== id || typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 255 ||
            typeof doc.text !== 'string' || !doc.text.trim() || doc.text.length > MAX_TEXT_CHARS) throw failure('invalid_record');
        result.push({ id, status:'indexed', doc });
      } catch { result.push({ id, status:'unavailable' }); }
    }
    return result;
  }
  async function documents() {
    const all = await records();
    // Code security: incomplete knowledge must not be treated as a complete search.
    if (all.some(record => record.status !== 'indexed')) throw failure('knowledge_records_unavailable');
    return all.map(record => record.doc);
  }
  async function addText({ name, text }) {
    if (typeof text !== 'string' || !text.trim()) throw failure('empty_document');
    if (text.length > MAX_TEXT_CHARS) throw failure('text_too_large');
    if (typeof name !== 'string' || !name.trim() || name.length > 255) throw failure('invalid_name');
    await ensureDirectory();
    const doc = { id: crypto.randomBytes(16).toString('hex'), name: name.trim(), text, createdAt: new Date().toISOString() };
    await fs.writeFile(fileFor(doc.id), JSON.stringify(doc), { flag: 'wx', mode: 0o600 });
    return { id: doc.id, name: doc.name, createdAt: doc.createdAt, status: 'indexed', characters: text.length };
  }
  return {
    addText,
    async get(id) {
      fileFor(id);
      const record = (await records()).find((item) => item.id === id);
      if (record?.status === 'unavailable') throw failure('knowledge_records_unavailable');
      const doc = record?.doc;
      if (!doc) throw failure('document_not_found');
      return doc;
    },
    async update(id, { name, text }) {
      const doc = await this.get(id);
      if (typeof text !== 'string' || !text.trim()) throw failure('empty_document');
      if (text.length > MAX_TEXT_CHARS) throw failure('text_too_large');
      if (typeof name !== 'string' || !name.trim() || name.length > 255) throw failure('invalid_name');
      const temporary = path.join(directory, `.${crypto.randomBytes(16).toString('hex')}.tmp`);
      try {
        await fs.writeFile(temporary, JSON.stringify({ ...doc, name: name.trim(), text }), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, fileFor(id));
      } finally { await fs.unlink(temporary).catch(() => {}); }
    },
    async importFile(filePath) {
      if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw failure('invalid_path');
      const data = await readImportFile(filePath);
      const text = await extractFile(filePath, data);
      return addText({ name: path.basename(filePath), text });
    },
    async list() {
      return (await records()).map(({ id, status, doc }) => status === 'indexed'
        ? { id, name:doc.name, createdAt:doc.createdAt, status, characters:doc.text.length }
        : { id, name:'不可用的知识记录', status, characters:0 });
    },
    async remove(id) {
      await ensureDirectory();
      const file = fileFor(id);
      if (!(await records()).some(record => record.id === id)) throw failure('document_not_found');
      const stat = await fs.lstat(file);
      // Code security: never follow links or remove another user's record during repair.
      if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && stat.uid !== process.getuid())) throw failure('unsafe_record');
      await fs.unlink(file);
    },
    async search(query, { limit = 5, maxChars = 3000 } = {}) {
      if (typeof query !== 'string') throw failure('invalid_query');
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(maxChars) || maxChars < 1 || maxChars > 12000) throw failure('invalid_limit');
      const docs = await documents();
      const terms = tokens(query.slice(0, 4000));
      if (!terms.length) return [];
      const results = [];
      for (const doc of docs) {
        chunks(doc.text).forEach((text, chunkIndex) => {
          const available = new Set(tokens(text));
          const score = terms.filter((term) => available.has(term)).length;
          if (score) results.push({ sourceId: doc.id, name: doc.name, chunkIndex, text, score });
        });
      }
      results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.sourceId.localeCompare(b.sourceId) || a.chunkIndex - b.chunkIndex);
      let remaining = maxChars;
      return results.slice(0, limit).flatMap(({ score, ...result }) => {
        if (remaining <= 0) return [];
        result.text = result.text.slice(0, remaining);
        remaining -= result.text.length;
        return [result];
      });
    },
  };
}

module.exports = { createKnowledgeStore };
