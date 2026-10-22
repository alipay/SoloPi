import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'resources', 'branding', 'solopi-desktop-app-icon.png');
const iconPngPath = path.join(root, 'build', 'icon.png');
const iconsetPath = path.join(root, 'build', 'glassbox.iconset');
const icnsPath = path.join(root, 'build', 'icon.icns');

if (!fs.existsSync(sourcePath)) {
  throw new Error(`GlassBox icon source is missing: ${sourcePath}`);
}

const variants = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

function resize(outputPath, size) {
  execFileSync('sips', [
    '--resampleHeightWidth',
    String(size),
    String(size),
    sourcePath,
    '--out',
    outputPath,
  ], { cwd: root, stdio: 'ignore' });
}

fs.rmSync(iconsetPath, { recursive: true, force: true });
fs.mkdirSync(iconsetPath, { recursive: true });
resize(iconPngPath, 1024);
for (const [fileName, size] of variants) {
  resize(path.join(iconsetPath, fileName), size);
}
fs.rmSync(icnsPath, { force: true });
const icnsEntries = [
  ['icp4', 'icon_16x16.png'],
  ['icp5', 'icon_16x16@2x.png'],
  ['icp6', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_128x128@2x.png'],
  ['ic09', 'icon_256x256@2x.png'],
  ['ic10', 'icon_512x512@2x.png'],
].map(([type, fileName]) => {
  const payload = fs.readFileSync(path.join(iconsetPath, fileName));
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(payload.length + 8, 4);
  return Buffer.concat([header, payload]);
});
const icnsBody = Buffer.concat(icnsEntries);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 4, 'ascii');
icnsHeader.writeUInt32BE(icnsBody.length + 8, 4);
fs.writeFileSync(icnsPath, Buffer.concat([icnsHeader, icnsBody]));

console.log(JSON.stringify({
  source: sourcePath,
  iconPng: iconPngPath,
  iconset: iconsetPath,
  icns: icnsPath,
  variants: variants.map(([fileName, size]) => ({ fileName, size })),
}, null, 2));
