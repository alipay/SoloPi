import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, chmod, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const { createKnowledgeStore } = require('../electron/reply-knowledge.js');

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'solopi-knowledge-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: createKnowledgeStore({ directory: path.join(dir, 'store') }) };
}

async function docx(text, doctype = '') {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?>${doctype}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function pdf(text) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(output)); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return output;
}

test('imports text, markdown, PDF and DOCX, and persists searchable sources', async (t) => {
  const { dir, store } = await fixture(t);
  const files = [ ['one.txt', '售后退货期限七天'], ['two.md', '# 使用说明\n支持离线操作'], ['three.pdf', pdf('warranty support')], ['four.docx', await docx('product guide')] ];
  for (const [name, content] of files) {
    const file = path.join(dir, name);
    await writeFile(file, content);
    assert.equal((await store.importFile(file)).status, 'indexed');
  }
  assert.equal((await store.list()).length, 4);
  const reopened = createKnowledgeStore({ directory: path.join(dir, 'store') });
  assert.equal((await reopened.search('退货期限'))[0].name, 'one.txt');
  assert.equal((await reopened.search('warranty'))[0].name, 'three.pdf');
  assert.equal((await reopened.search('product'))[0].name, 'four.docx');
  assert.deepEqual(await reopened.search('unrelatedxyz'), []);
  const item = (await reopened.list())[0];
  await reopened.remove(item.id);
  assert.equal((await reopened.list()).length, 3);
});

test('rejects invalid, empty, oversize, deceptive and unsafe input', async (t) => {
  const { dir, store } = await fixture(t);
  const bad = async (name, data, code) => {
    const file = path.join(dir, name);
    await writeFile(file, data);
    await assert.rejects(store.importFile(file), { code });
  };
  await bad('empty.txt', '  ', 'empty_document');
  await bad('fake.pdf', 'not a PDF', 'invalid_pdf');
  await bad('no-text.pdf', pdf(''), 'empty_document');
  await bad('fake.docx', 'not a document', 'invalid_docx');
  await bad('unsupported.html', 'text', 'unsupported_file_type');
  await bad('binary.txt', Buffer.from([0, 1]), 'invalid_text_encoding');
  await bad('huge.txt', Buffer.alloc(10 * 1024 * 1024 + 1), 'file_too_large');
  await bad('doctype.docx', await docx('test', '<!DOCTYPE x>'), 'invalid_docx');
  await assert.rejects(store.remove('../outside'), { code: 'invalid_id' });
  const link = path.join(dir, 'link.txt');
  await symlink(path.join(dir, 'empty.txt'), link);
  await assert.rejects(store.importFile(link));
});

test('returns bounded excerpts with source and supports direct editing', async (t) => {
  const { store } = await fixture(t);
  const item = await store.addText({ name: '说明', text: '服务规则：退款需要提供订单。' });
  const matches = await store.search('退款规则', { limit: 1, maxChars: 8 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].sourceId, item.id);
  assert.equal(matches[0].name, '说明');
  assert.equal(matches[0].text.length, 8);
  await store.update(item.id, { name: '新说明', text: '物流一般三天送达。' });
  assert.equal((await store.get(item.id)).name, '新说明');
  assert.equal((await store.search('物流'))[0].sourceId, item.id);
  assert.deepEqual(await store.search('退款'), []);
  await assert.rejects(store.search('退款', { limit: 0 }), { code: 'invalid_limit' });
});

test('finds Chinese and English terms across chunk boundaries with bounded results and sources', async (t) => {
  const { store } = await fixture(t);
  const chinese = await store.addText({ name: '中文说明', text: `${'甲'.repeat(499)}退款需要订单号` });
  const english = await store.addText({ name: 'English guide', text: `${' '.repeat(497)}warranty details` });
  const cn = await store.search('退款', { limit: 1, maxChars: 500 });
  const en = await store.search('warranty', { limit: 1, maxChars: 500 });
  assert.equal(cn.length, 1);
  assert.equal(cn[0].sourceId, chinese.id);
  assert.equal(cn[0].name, '中文说明');
  assert.ok(cn[0].text.includes('退款'));
  assert.equal(en.length, 1);
  assert.equal(en[0].sourceId, english.id);
  assert.equal(en[0].name, 'English guide');
  assert.ok(en[0].text.includes('warranty'));
  const fullwidth = await store.addText({ name: 'fullwidth', text: `${' '.repeat(497)}ｗａｒｒａｎｔｙ` });
  assert.ok((await store.search('warranty', { limit: 5 })).some(item => item.sourceId === fullwidth.id));
});

test('handles long Latin tokens without partial matches or exceeding excerpt limits', async (t) => {
  const { store } = await fixture(t);
  const longWord = 'a'.repeat(600);
  const item = await store.addText({ name: 'long token', text: `${' '.repeat(499)}${longWord} end` });
  const result = await store.search(longWord, { limit: 1, maxChars: 80 });
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceId, item.id);
  assert.equal(result[0].text.length, 80);
  assert.deepEqual(await store.search('a'.repeat(599)), []);
  await store.addText({ name: 'oversized token', text: 'b'.repeat(10000) });
  assert.deepEqual(await store.search('b'.repeat(4000)), []);
});

test('reports insecure records and blocks search until repaired', async (t) => {
  const { dir, store } = await fixture(t);
  const item = await store.addText({ name: 'private', text: 'private data' });
  const record = path.join(dir, 'store', `${item.id}.json`);
  if (process.platform !== 'win32') {
    await chmod(record, 0o644);
    assert.equal((await store.list())[0].status, 'unavailable');
    await assert.rejects(store.search('private'), {code:'knowledge_records_unavailable'});
    await store.remove(item.id);
    assert.deepEqual(await store.search('private'), []);
    await chmod(path.join(dir, 'store'), 0o755);
    await assert.rejects(store.list(), { code: 'unsafe_directory' });
  }
  const target = path.join(dir, 'target');
  await mkdir(target);
  const link = path.join(dir, 'linked-store');
  await symlink(target, link, 'dir');
  await assert.rejects(createKnowledgeStore({ directory: link }).list(), { code: 'unsafe_directory' });
});

test('corrupt records are visible, block retrieval and can be removed without losing healthy records', async (t) => {
  const { dir, store } = await fixture(t);
  const healthy = await store.addText({name:'healthy',text:'answer'});
  const broken = await store.addText({name:'broken',text:'missing answer'});
  await writeFile(path.join(dir,'store',`${broken.id}.json`), '{invalid');
  const entries = await store.list();
  assert.equal(entries.find(item => item.id === broken.id).status, 'unavailable');
  assert.equal((await store.get(healthy.id)).name, 'healthy');
  await assert.rejects(store.get(broken.id), {code:'knowledge_records_unavailable'});
  await assert.rejects(store.search('answer'), {code:'knowledge_records_unavailable'});
  await assert.rejects(store.search(''), {code:'knowledge_records_unavailable'});
  await store.remove(broken.id);
  assert.equal((await store.search('answer'))[0].sourceId, healthy.id);
});

test('linked records block retrieval and are not deleted by repair', async (t) => {
  const {dir, store} = await fixture(t);
  await store.addText({name:'healthy',text:'answer'});
  const id = 'a'.repeat(32);
  const outside = path.join(dir, 'outside');
  await writeFile(outside, 'external');
  await symlink(outside, path.join(dir, 'store', `${id}.json`));
  assert.equal((await store.list()).find(item => item.id === id).status, 'unavailable');
  await assert.rejects(store.search('answer'), {code:'knowledge_records_unavailable'});
  await assert.rejects(store.remove(id), {code:'unsafe_record'});
});
