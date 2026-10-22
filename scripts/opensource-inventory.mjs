// Evidence inventory only; this is not a legal approval or vulnerability scan.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const dependencies = Object.entries(lock.packages || {}).filter(([name]) => name).map(([location, info]) => {
  let installed = {};
  try { installed = JSON.parse(fs.readFileSync(path.join(root, location, 'package.json'), 'utf8')); } catch {}
  return { location, name: installed.name || location.split('node_modules/').pop(), version: info.version, license: info.license || installed.license || 'REVIEW_REQUIRED', dev: Boolean(info.dev), integrity: info.integrity || null };
});
const inventory = { generatedAt: new Date().toISOString(), scope: 'current lockfile; binaries and company IP need separate approval', projectLicense: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).license || 'COMPANY_DECISION_REQUIRED', dependencies };
process.stdout.write(JSON.stringify(inventory, null, 2) + '\n');
