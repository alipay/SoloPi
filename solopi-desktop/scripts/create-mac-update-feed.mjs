import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');
const { serializeToYaml } = require('builder-util');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const productName = packageJson.productName || 'solopi-desktop';
const version = packageJson.version;
const releaseDir = path.join(root, 'release');
const zipName = `${productName}-${version}-arm64-mac.zip`;
const zipPath = path.join(releaseDir, zipName);
const blockmapPath = `${zipPath}.blockmap`;
const manifestPath = path.join(releaseDir, 'latest-mac.yml');

if (!fs.existsSync(zipPath)) {
  throw new Error(`Missing update ZIP: ${zipPath}`);
}

fs.rmSync(blockmapPath, { force: true });
fs.rmSync(manifestPath, { force: true });

const updateFile = await buildBlockMap(zipPath, 'gzip', blockmapPath);
const manifest = {
  version,
  files: [{
    url: zipName,
    sha512: updateFile.sha512,
    size: updateFile.size,
  }],
  path: zipName,
  sha512: updateFile.sha512,
  releaseDate: new Date().toISOString(),
};

fs.writeFileSync(manifestPath, serializeToYaml(manifest));
console.log(JSON.stringify({
  success: true,
  version,
  zipPath,
  blockmapPath,
  manifestPath,
  zipSize: updateFile.size,
  zipSha512: updateFile.sha512,
}, null, 2));
