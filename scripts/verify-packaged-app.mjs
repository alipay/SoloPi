import { verifyFFmpegCompliance } from './ffmpeg-compliance.mjs';
import { verifyFFmpegSourceArchive } from './create-ffmpeg-source-archive.mjs';
import { verifyThirdPartyNotices } from './third-party-notices.mjs';
import { verifyElectronEntitlements } from './verify-mac-entitlements.mjs';
import {verifyRetiredAppUpdate} from './verify-retired-app-update.mjs';
import { verifyRetiredCapturePage } from './verify-retired-capture-page.mjs';
import { verifyPackagedRuntimeDependencies } from './verify-packaged-runtime-dependencies.mjs';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'release', 'mac-arm64', 'solopi-desktop.app');
verifyElectronEntitlements(appPath);
const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
const cliModulePath = path.join(appPath, 'Contents', 'Resources', 'cli', 'adb-error.cjs');
const cliSourcePath = path.join(appPath, 'Contents', 'Resources', 'cli', 'glassbox-cli.mjs');
const cliLauncherPath = path.join(appPath, 'Contents', 'Resources', 'bin', 'glassbox');
const integrityPath = path.join(root, 'release', 'packaged-app-sha256.json');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const dmgPath = path.join(root, 'release', `solopi-desktop-${packageJson.version}-arm64.dmg`);
const zipPath = path.join(root, 'release', `solopi-desktop-${packageJson.version}-arm64-mac.zip`);
const packagedUpdateConfigPath = path.join(appPath, 'Contents', 'Resources', 'app-update.yml');
const packagedIconPath = path.join(appPath, 'Contents', 'Resources', 'icon.icns');
const sourceIconPath = path.join(root, 'build', 'icon.icns');
const packagedMediaRuntimePath = path.join(appPath, 'Contents', 'Resources', 'media-runtime', 'darwin-arm64');
const sourceMediaRuntimePath = path.join(root, 'resources', 'media-runtime', 'darwin-arm64');
const packagedGitRuntime = path.join(appPath, 'Contents', 'Resources', 'git-runtime', 'darwin-arm64');
execFileSync(process.execPath, [path.join(root, 'scripts/verify-git-runtime.mjs'), '--runtime', packagedGitRuntime, '--static'], { stdio: 'inherit' });
execFileSync('codesign', ['--verify', '--strict', path.join(packagedGitRuntime, 'bin', 'git-lfs')], { stdio: 'inherit' });
if (fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/git-runtime.cjs'), 'utf8') !== fs.readFileSync(path.join(root, 'electron/git-runtime.js'), 'utf8')) throw Error('Packaged CLI Git runtime is stale');
const mediaRuntimeExecutablePaths = new Set(['bin/adb', 'bin/scrcpy', 'bin/ffmpeg']);

function normalizeUnsignedMachOSlice(buffer, filePath) {
  if (buffer.length < 32 || buffer.readUInt32LE(0) !== 0xfeedfacf) {
    throw new Error(`Expected a 64-bit little-endian Mach-O slice: ${filePath}`);
  }
  const normalized = Buffer.from(buffer);
  const commandCount = normalized.readUInt32LE(16);
  let cursor = 32;
  for (let index = 0; index < commandCount; index += 1) {
    if (cursor + 8 > normalized.length) {
      throw new Error(`Invalid Mach-O load commands: ${filePath}`);
    }
    const command = normalized.readUInt32LE(cursor);
    const commandSize = normalized.readUInt32LE(cursor + 4);
    if (commandSize < 8 || cursor + commandSize > normalized.length) {
      throw new Error(`Invalid Mach-O load command size: ${filePath}`);
    }
    if (command === 0x19) {
      const segmentName = normalized.subarray(cursor + 8, cursor + 24)
        .toString('utf8')
        .replace(/\0.*$/s, '');
      if (segmentName === '__LINKEDIT') {
        // Re-signing only changes the embedded signature allocation at the end
        // of __LINKEDIT. codesign --remove-signature removes the blob but keeps
        // the signer-specific segment size, so normalize those two sizes before
        // comparing the actual executable bytes.
        normalized.fill(0, cursor + 32, cursor + 40);
        normalized.fill(0, cursor + 48, cursor + 56);
      }
    }
    cursor += commandSize;
  }
  return normalized;
}

function fingerprintMachOCode(filePath, workspace, label) {
  const architectureOutput = execFileSync('lipo', ['-archs', filePath], {
    cwd: root,
    encoding: 'utf8',
  });
  const architectures = architectureOutput.trim().split(/\s+/).filter(Boolean).sort();
  return architectures.map((architecture) => {
    const copyPath = path.join(workspace, `${label}-${architecture}`);
    if (architectures.length === 1) {
      fs.copyFileSync(filePath, copyPath);
    } else {
      execFileSync('lipo', [filePath, '-thin', architecture, '-output', copyPath], {
        cwd: root,
        stdio: 'inherit',
      });
    }
    const removal = spawnSync('codesign', ['--remove-signature', copyPath], {
      cwd: root,
      encoding: 'utf8',
    });
    if (removal.status !== 0) {
      throw new Error(`Unable to normalize media runtime signature for ${filePath}: ${removal.stderr || removal.stdout}`);
    }
    const normalized = normalizeUnsignedMachOSlice(fs.readFileSync(copyPath), filePath);
    return `${architecture}:${crypto.createHash('sha256').update(normalized).digest('hex')}`;
  });
}

if (!fs.existsSync(asarPath)) {
  throw new Error(`Packaged app.asar is missing: ${asarPath}`);
}

verifyRetiredCapturePage(file => asar.extractFile(asarPath, file));
verifyPackagedRuntimeDependencies(asarPath);
verifyThirdPartyNotices(path.join(appPath, 'Contents', 'Resources', 'third-party'), { targetPlatform: 'darwin' });
verifyRetiredAppUpdate(file => asar.extractFile(asarPath, file));
const packagedFiles = new Set(asar.listPackage(asarPath));
const requiredAsarFiles = [
  '/electron/main.js',
  '/electron/adb-error.js',
  '/electron/media-process-queue.js',
  '/electron/media-runtime.js',
  '/electron/scrcpy-recording.js',
  '/electron/task-screen-recording.js',
  '/dist/index.html',
  '/dist/bundle.js',
];
const missingAsarFiles = requiredAsarFiles.filter((file) => !packagedFiles.has(file));
if (missingAsarFiles.length) {
  throw new Error(`Packaged app.asar is incomplete: ${missingAsarFiles.join(', ')}`);
}

if (!fs.existsSync(cliModulePath)) {
  throw new Error(`Packaged CLI ADB classification module is missing: ${cliModulePath}`);
}
if (!fs.existsSync(packagedIconPath) || !fs.existsSync(sourceIconPath)) {
  throw new Error('Packaged or generated macOS icon.icns is missing');
}
if (fs.existsSync(packagedUpdateConfigPath)) {
  throw new Error('Unexpected bundled update bootstrap; configure update endpoints at runtime');
}
const mediaRuntimeVerificationWorkspace = fs.mkdtempSync(path.join(root, 'build', 'verify-media-runtime-'));
try {
  verifyFFmpegCompliance(sourceMediaRuntimePath);
  await verifyFFmpegSourceArchive(path.join(root,'release',`solopi-desktop-${packageJson.version}-darwin-arm64-ffmpeg-sources.tar.gz`),{requireChecksum:true});
  const record=JSON.parse(fs.readFileSync(path.join(sourceMediaRuntimePath,'ffmpeg-build.json'),'utf8'));
  const recordFiles=['ffmpeg-build.json',record.recipe.path,...(record.buildFiles||[]).map(r=>r.path),...record.sources.flatMap(s=>[s.archive.path,s.license.path,...(s.buildRecipe?[s.buildRecipe.path]:[])])];
  for(const file of recordFiles) if(!fs.readFileSync(path.join(packagedMediaRuntimePath,file)).equals(fs.readFileSync(path.join(sourceMediaRuntimePath,file)))) throw Error(`Packaged FFmpeg source/build material differs: ${file}`);
  const sourceGitRuntime = path.join(root, 'resources/git-runtime/darwin-arm64');
  const packagedGitCode = fingerprintMachOCode(path.join(packagedGitRuntime, 'bin/git-lfs'), mediaRuntimeVerificationWorkspace, 'packaged-git-lfs');
  const sourceGitCode = fingerprintMachOCode(path.join(sourceGitRuntime, 'bin/git-lfs'), mediaRuntimeVerificationWorkspace, 'source-git-lfs');
  if (JSON.stringify(packagedGitCode) !== JSON.stringify(sourceGitCode)) throw Error('Packaged Git LFS code differs from verified source');
  if (!fs.readFileSync(path.join(packagedGitRuntime, 'LICENSES/git-lfs-LICENSE.md')).equals(fs.readFileSync(path.join(sourceGitRuntime, 'LICENSES/git-lfs-LICENSE.md')))) throw Error('Packaged Git LFS license differs from source');
  for (const relativePath of [
    'bin/adb',
    'bin/scrcpy',
    'bin/ffmpeg',
    'share/scrcpy/scrcpy-server',
    'manifest.json',
    'provenance.json',
  ]) {
    const packagedPath = path.join(packagedMediaRuntimePath, relativePath);
    const sourcePath = path.join(sourceMediaRuntimePath, relativePath);
    if (!fs.existsSync(packagedPath) || !fs.existsSync(sourcePath)) {
      throw new Error(`Packaged media runtime is incomplete: ${relativePath}`);
    }
    if (mediaRuntimeExecutablePaths.has(relativePath)) {
      execFileSync('codesign', ['--verify', '--strict', '--verbose=2', packagedPath], {
        cwd: root,
        stdio: 'inherit',
      });
      const label = relativePath.replaceAll('/', '-');
      const packagedContent = fingerprintMachOCode(
        packagedPath,
        mediaRuntimeVerificationWorkspace,
        `packaged-${label}`,
      );
      const sourceContent = fingerprintMachOCode(
        sourcePath,
        mediaRuntimeVerificationWorkspace,
        `source-${label}`,
      );
      if (JSON.stringify(packagedContent) !== JSON.stringify(sourceContent)) {
        throw new Error(`Packaged media runtime code does not match the verified source: ${relativePath}`);
      }
      continue;
    }
    if (!fs.readFileSync(packagedPath).equals(fs.readFileSync(sourcePath))) {
      throw new Error(`Packaged media runtime does not match the verified source: ${relativePath}`);
    }
  }
} finally {
  fs.rmSync(mediaRuntimeVerificationWorkspace, { recursive: true, force: true });
}
for (const name of ['android-top', 'android-thread-stacks', 'owned-log-process', 'performance-battery', 'bugreport/zip', 'bugreport/parser', 'bugreport/jobs', 'bugreport/worker']) {
  if (!asar.extractFile(asarPath, `electron/${name}.js`).equals(fs.readFileSync(path.join(root, 'electron', `${name}.js`)))) throw new Error(`Packaged ${name} differs from source`);
}
if (!fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/android-top.cjs')).equals(fs.readFileSync(path.join(root, 'electron/android-top.js')))) throw new Error('Packaged CLI top parser differs from source');
const extractedModule = asar.extractFile(asarPath, 'electron/adb-error.js');
const sourceModule = fs.readFileSync(path.join(root, 'electron', 'adb-error.js'));
if (!extractedModule.equals(sourceModule)) {
  throw new Error('Packaged electron/adb-error.js does not match the source module');
}

const packagedMain = asar.extractFile(asarPath, 'electron/main.js');
if (!packagedMain.equals(fs.readFileSync(path.join(root, 'electron', 'main.js')))) {
  throw new Error('Packaged electron/main.js does not match the source file');
}
if (!fs.readFileSync(cliSourcePath).equals(fs.readFileSync(path.join(root, 'scripts', 'glassbox-cli.mjs')))) {
  throw new Error('Packaged CLI module does not match the source file');
}
if (!fs.readFileSync(cliLauncherPath).equals(fs.readFileSync(path.join(root, 'resources', 'bin', 'glassbox')))) {
  throw new Error('Packaged CLI launcher does not match the source file');
}

execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath], {
  cwd: root,
  stdio: 'inherit',
});

const signatureInspection = spawnSync('codesign', ['-dv', '--verbose=4', appPath], {
  cwd: root,
  encoding: 'utf8',
});
if (signatureInspection.status !== 0) {
  throw new Error(`Unable to inspect packaged app signature: ${signatureInspection.stderr || signatureInspection.stdout}`);
}
const signatureDetails = `${signatureInspection.stdout || ''}\n${signatureInspection.stderr || ''}`;
if (!signatureDetails.includes('Identifier=com.glassbox.desktop')) {
  throw new Error('Packaged app signature does not bind Identifier=com.glassbox.desktop');
}
if (!signatureDetails.includes('Sealed Resources')) {
  throw new Error('Packaged app signature does not seal bundle resources');
}
const forceAdHocSigning = process.env.GLASSBOX_FORCE_ADHOC_SIGNING === '1';
if (forceAdHocSigning && !signatureDetails.includes('Signature=adhoc')) {
  throw new Error('Temporary QA package must have Signature=adhoc');
}
if (
  signatureDetails.includes('Signature=adhoc')
  && process.env.GLASSBOX_ALLOW_ADHOC_SIGNING !== '1'
  && process.env.GLASSBOX_FORCE_ADHOC_SIGNING !== '1'
) {
  throw new Error('Packaged app is ad-hoc signed. A QA/distributable DMG or ZIP requires Developer ID Application signing.');
}

function readSignatureField(details, name) {
  const match = details.match(new RegExp(`^${name}=([^\\n\\r]+)$`, 'm'));
  return String(match?.[1] || '').trim();
}

function inspectSignedCode(codePath) {
  const inspection = spawnSync('codesign', ['-dv', '--verbose=4', codePath], {
    cwd: root,
    encoding: 'utf8',
  });
  if (inspection.status !== 0) {
    throw new Error(`Unable to inspect nested signature: ${codePath}: ${inspection.stderr || inspection.stdout}`);
  }
  return `${inspection.stdout || ''}\n${inspection.stderr || ''}`;
}

const appTeamIdentifier = readSignatureField(signatureDetails, 'TeamIdentifier');
const appUsesDeveloperId = signatureDetails.includes('Authority=Developer ID Application:');
if (appUsesDeveloperId) {
  if (!appTeamIdentifier || appTeamIdentifier === 'not set') {
    throw new Error('Developer ID package is missing a TeamIdentifier');
  }
  if (!signatureDetails.includes('Timestamp=')) {
    throw new Error('Developer ID package is missing a secure timestamp');
  }
  if (!/^CodeDirectory .*flags=.*runtime/m.test(signatureDetails)) {
    throw new Error('Developer ID package is missing hardened runtime');
  }
  for (const relativePath of mediaRuntimeExecutablePaths) {
    const executablePath = path.join(packagedMediaRuntimePath, relativePath);
    const nestedDetails = inspectSignedCode(executablePath);
    if (nestedDetails.includes('Signature=adhoc')) {
      throw new Error(`Packaged media runtime is ad-hoc signed: ${relativePath}`);
    }
    if (!nestedDetails.includes('Authority=Developer ID Application:')) {
      throw new Error(`Packaged media runtime is not Developer ID signed: ${relativePath}`);
    }
    if (readSignatureField(nestedDetails, 'TeamIdentifier') !== appTeamIdentifier) {
      throw new Error(`Packaged media runtime TeamIdentifier differs from the app: ${relativePath}`);
    }
    if (!nestedDetails.includes('Timestamp=')) {
      throw new Error(`Packaged media runtime is missing a secure timestamp: ${relativePath}`);
    }
    if (!/^CodeDirectory .*flags=.*runtime/m.test(nestedDetails)) {
      throw new Error(`Packaged media runtime is missing hardened runtime: ${relativePath}`);
    }
  }
}

function collectNestedCodeBundles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) {
      result.push(entryPath);
    }
    collectNestedCodeBundles(entryPath, result);
  }
  return result;
}

if (forceAdHocSigning) {
  const nestedBundles = collectNestedCodeBundles(path.join(appPath, 'Contents', 'Frameworks'));
  for (const nestedPath of nestedBundles) {
    const nestedInspection = spawnSync('codesign', ['-dv', '--verbose=2', nestedPath], {
      cwd: root,
      encoding: 'utf8',
    });
    const nestedDetails = `${nestedInspection.stdout || ''}\n${nestedInspection.stderr || ''}`;
    if (nestedInspection.status !== 0 || !nestedDetails.includes('Signature=adhoc')) {
      throw new Error(`Nested code is not consistently ad-hoc signed: ${nestedPath}`);
    }
  }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const infoPlist = execFileSync('plutil', ['-convert', 'json', '-o', '-', path.join(appPath, 'Contents', 'Info.plist')], {
  cwd: root,
  encoding: 'utf8',
});
const parsedInfoPlist = JSON.parse(infoPlist);
if (parsedInfoPlist.CFBundleIconFile !== 'icon.icns') {
  throw new Error(`Packaged CFBundleIconFile must be icon.icns: ${parsedInfoPlist.CFBundleIconFile || '(empty)'}`);
}
const dockIconPath = path.join(appPath, 'Contents', 'Resources', 'dock-icon.png');
if (!fs.existsSync(dockIconPath) || sha256(dockIconPath) !== sha256(path.join(root, 'resources', 'branding', 'solopi-desktop-app-icon.png'))) {
  throw new Error('Packaged Dock PNG is missing or differs from the development icon');
}
if (sha256(packagedIconPath) !== sha256(sourceIconPath)) {
  throw new Error('Packaged icon.icns does not match the generated GlassBox icon');
}

if (!fs.existsSync(integrityPath)) {
  throw new Error(`Packaged app integrity manifest is missing: ${integrityPath}`);
}
const integrity = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
if (forceAdHocSigning && integrity.signingMode !== 'adhoc-qa') {
  throw new Error(`Unexpected integrity manifest signing mode: ${integrity.signingMode}`);
}
for (const [name, record] of Object.entries(integrity.files || {})) {
  const filePath = path.join(root, 'release', record.path);
  const actual = sha256(filePath);
  if (actual !== record.sha256) {
    throw new Error(`Signed app file changed after final signing: ${name} ${record.sha256} != ${actual}`);
  }
}

if (fs.existsSync(dmgPath)) {
  execFileSync('hdiutil', ['verify', dmgPath], { cwd: root, stdio: 'inherit' });
}
if (fs.existsSync(zipPath)) {
  execFileSync('unzip', ['-t', zipPath], { cwd: root, stdio: 'inherit' });

}

console.log(`verified packaged app resources: ${appPath}`);

if (!fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/development-tasks.cjs')).equals(fs.readFileSync(path.join(root, 'electron/development-tasks.js')))) throw new Error('Packaged development task module mismatch');
if (!fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/task-visibility.cjs')).equals(fs.readFileSync(path.join(root, 'electron/task-visibility.js')))) throw new Error('Packaged task visibility module mismatch');

if (!fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/workflow-performance.cjs')).equals(fs.readFileSync(path.join(root, 'electron/workflow-performance.js')))) throw new Error('Packaged workflow performance module mismatch');

if (!fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/performance-battery.cjs')).equals(fs.readFileSync(path.join(root, 'electron/performance-battery.js')))) throw new Error('Packaged CLI battery parser differs from source');
if (!fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/workflow-log-text.cjs')).equals(fs.readFileSync(path.join(root, 'electron/workflow-log-text.js')))) throw new Error('Packaged CLI log sample validator differs from source');

if (!fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/diagnostics.cjs')).equals(fs.readFileSync(path.join(root, 'electron/diagnostics.js')))) throw new Error('Packaged diagnostics module mismatch');

if (!fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/workflow-log-diagnostics.cjs')).equals(fs.readFileSync(path.join(root, 'electron/workflow-log-diagnostics.js')))) throw new Error('Packaged CLI log diagnostics differs from source');

if (!fs.existsSync(path.join(appPath, "Contents/Resources/cli/headless-configuration.cjs"))) throw Error("Packaged CLI headless configuration service is missing");
if (fs.readFileSync(path.join(appPath, 'Contents/Resources/cli/task-case-query.cjs'), 'utf8') !== fs.readFileSync(path.join(root, 'electron/task-case-query.js'), 'utf8')) throw Error('Packaged CLI task case query is stale');

for(const name of ['case-selection','case-discovery','selection-receipt','case-scope-summary']){const expected=fs.readFileSync(path.join(root,'electron','agent',name+'.js'),'utf8').replace("require('./case-discovery')","require('./case-discovery.cjs')").replaceAll("require('./selection-receipt')","require('./selection-receipt.cjs')").replaceAll("require('./case-scope-summary')","require('./case-scope-summary.cjs')");if(fs.readFileSync(path.join(appPath,'Contents/Resources/cli',name+'.cjs'),'utf8')!==expected)throw Error('Packaged case selection module mismatch: '+name);}

if(fs.readFileSync(path.join(appPath,'Contents/Resources/cli/task-device-selection.cjs'),'utf8')!==fs.readFileSync(path.join(root,'electron/task-device-selection.js'),'utf8'))throw Error('Packaged device selection module mismatch');
