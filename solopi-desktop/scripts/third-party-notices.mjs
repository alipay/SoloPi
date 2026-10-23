import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const legalName = /^(licen[cs]e|notice|copying|copyright)([._-].*)?$/i;
const marker = { darwin: 'Electron.app', linux: 'electron', win32: 'electron.exe' };
const safeRelative = file => typeof file === 'string' && !path.posix.isAbsolute(file) && !file.split(/[\\/]/).includes('..') && !file.includes('\\');

function legalFiles(directory, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === '.git') continue;
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...legalFiles(directory, file));
    else if (entry.isFile() && legalName.test(entry.name)) {
      const data = fs.readFileSync(path.join(directory, file));
      if (data.length && !data.includes(0)) result.push({ file, data });
    }
  }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}

// Uses only target-runtime files and the installed lock tree; never executes a binary.
export function prepareThirdPartyNotices({ projectRoot, resourcesDir, electronDist, targetPlatform, electronVersion }) {
  if (!marker[targetPlatform]) throw Error(`Unsupported notice target: ${targetPlatform}`);
  const dist = path.resolve(projectRoot, electronDist || 'node_modules/electron/dist');
  const version = fs.readFileSync(path.join(dist, 'version'), 'utf8').trim();
  if (version !== electronVersion || !fs.existsSync(path.join(dist, marker[targetPlatform]))) throw Error('Electron notice runtime version/platform mismatch');
  const lock = readJson(path.join(projectRoot, 'package-lock.json'));
  const project = readJson(path.join(projectRoot, 'package.json'));
  if (lock.packages?.['']?.version !== project.version) throw Error('Project lock version mismatch');
  const supplementDir = path.join(projectRoot, 'resources/third-party/npm-supplements');
  const supplements = fs.existsSync(path.join(supplementDir, 'manifest.json')) ? readJson(path.join(supplementDir, 'manifest.json')).licenses : [];
  const packages = [];
  const sections = [];
  for (const [location, entry] of Object.entries(lock.packages || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!location || entry.dev || entry.link) continue;
    if (!safeRelative(location) || !location.startsWith('node_modules/')) throw Error(`Unsafe package location: ${location}`);
    const directory = path.join(projectRoot, location);
    if (!fs.existsSync(directory) && entry.optional) continue;
    const metadata = readJson(path.join(directory, 'package.json'));
    if (metadata.version !== entry.version) throw Error(`Installed dependency lock mismatch: ${location}`);
    const files = legalFiles(directory);
    if (!files.some(item => !item.file.includes('/'))) {
      const supplement = supplements.find(item => item.name === metadata.name && item.version === metadata.version);
      if (!supplement || !safeRelative(supplement.file) || !/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//.test(supplement.source)) throw Error(`Missing license text: ${metadata.name}@${metadata.version}`);
      const data = fs.readFileSync(path.join(supplementDir, supplement.file));
      if (hash(data) !== supplement.sha256) throw Error(`Supplement hash mismatch: ${metadata.name}`);
      files.unshift({ file: `upstream/${supplement.file}`, data, source: supplement.source });
    }
    const license = metadata.license || entry.license;
    if (!license) throw Error(`Missing license identifier: ${metadata.name}`);
    packages.push({ name: metadata.name, version: metadata.version, license, location, notices: files.map(({ file, data, source }) => ({ file, sha256: hash(data), ...(source ? { source } : {}) })) });
    sections.push(`===== ${metadata.name}@${metadata.version} (${license}) [${location}] =====\n` + files.map(({ file, data, source }) => `--- ${file}${source ? ` (${source})` : ''} ---\n${data.toString('utf8')}\n`).join('\n'));
  }
  const output = path.join(resourcesDir, 'third-party');
  fs.mkdirSync(resourcesDir, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(resourcesDir, '.third-party-'));
  const artifacts = [];
  const put = (file, data) => {
    if (!data.length) throw Error(`Empty notice: ${file}`);
    fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
    fs.writeFileSync(path.join(temporary, file), data);
    artifacts.push({ file, sha256: hash(data), bytes: Buffer.byteLength(data) });
  };
  try {
    put('LICENSE.project.txt', fs.readFileSync(path.join(projectRoot, 'LICENSE')));
    put('NOTICE.project.txt', fs.readFileSync(path.join(projectRoot, 'NOTICE')));
    put('electron/LICENSE.electron.txt', fs.readFileSync(path.join(dist, 'LICENSE')));
    put('electron/LICENSES.chromium.html', fs.readFileSync(path.join(dist, 'LICENSES.chromium.html')));
    put('npm/THIRD-PARTY-LICENSES.txt', sections.join('\n'));
    fs.writeFileSync(path.join(temporary, 'inventory.json'), JSON.stringify({ schemaVersion: 1, project: { name: project.name, version: project.version }, targetPlatform, electronVersion: version, lockSha256: hash(fs.readFileSync(path.join(projectRoot, 'package-lock.json'))), artifacts, packages }, null, 2) + '\n');
    verifyThirdPartyNotices(temporary, { targetPlatform, electronVersion });
    if (fs.existsSync(output)) {
      verifyThirdPartyNotices(output);
      fs.rmSync(output, { recursive: true });
    }
    fs.renameSync(temporary, output);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  return verifyThirdPartyNotices(output, { targetPlatform, electronVersion });
}

export function verifyThirdPartyNotices(directory, expected = {}) {
  const inventory = readJson(path.join(directory, 'inventory.json'));
  if (inventory.schemaVersion !== 1 || !marker[inventory.targetPlatform] || !Array.isArray(inventory.packages) || !inventory.packages.length) throw Error('Invalid third-party inventory');
  for (const key of ['targetPlatform', 'electronVersion']) if (expected[key] && inventory[key] !== expected[key]) throw Error(`Notice ${key} mismatch`);
  const required = new Set(['LICENSE.project.txt', 'NOTICE.project.txt', 'electron/LICENSE.electron.txt', 'electron/LICENSES.chromium.html', 'npm/THIRD-PARTY-LICENSES.txt']);
  for (const item of inventory.artifacts || []) {
    if (!safeRelative(item.file) || fs.lstatSync(path.join(directory, item.file)).isSymbolicLink()) throw Error('Unsafe notice path');
    const data = fs.readFileSync(path.join(directory, item.file));
    if (!data.length || hash(data) !== item.sha256 || data.length !== item.bytes) throw Error(`Notice integrity mismatch: ${item.file}`);
    required.delete(item.file);
  }
  if (required.size) throw Error(`Missing notices: ${[...required].join(', ')}`);
  for (const item of inventory.packages) if (!item.name || !item.version || !item.license || !item.notices?.length) throw Error('Incomplete dependency notice record');
  return { packages: inventory.packages.length, artifacts: inventory.artifacts.length, targetPlatform: inventory.targetPlatform, electronVersion: inventory.electronVersion };
}
