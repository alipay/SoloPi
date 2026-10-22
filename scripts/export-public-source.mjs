#!/usr/bin/env node
// Explicit source boundary: never export a checkout, Git metadata or runtime state.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootFiles = new Set(['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','README.md','package.json','package-lock.json','webpack.config.js','tsconfig.json','postcss.config.js','tailwind.config.js','components.json','index.html','.gitattributes']);
const testFiles = new Set(['solopi-permissions.test.mjs','solopi-recording-recovery.test.mjs','solopi-native-replay.test.mjs','solopi-stop-convert.test.mjs','recording-dialog-ui.test.mjs','workflow-assertion-policy.test.mjs','workflow-execution-summary.test.mjs','component-configuration-compatibility.test.mjs','case-scope-selection.test.mjs','solopi-provider.test.mjs','quick-action-template-audit.test.mjs','cli-headless-runtime.test.mjs','agent-skill-renames.test.mjs','agent-experience-memory.test.mjs','preview-performance-regression.test.mjs','cli-case-list-projection.test.mjs','case-edit-refresh-regression.test.mjs','case-edit-guard.test.mjs','public-source.test.mjs','retired-app-update.test.mjs','device-preflight.test.mjs','workflow-editor-image-mock.test.mjs','sample-factory-navigation.test.mjs','agent-skill-refresh.test.mjs','solopi-import.test.mjs','task-result-delivery.test.mjs','agent-model-step-recovery.test.mjs','glasses-device-contract.test.mjs','agent-progress-policy.test.mjs','agent-skill-scope.test.mjs','agent-case-evidence-export.test.mjs']);
const docs = new Set(['docs/CLI_BACKGROUND_RUNTIME.md','docs/configuration.md','docs/agent/glassbox-cli-usage.md','docs/agent/MODEL_REQUEST_RECOVERY.md','docs/public-source.md','docs/SOLOPI_IMPORT.md']);
const resourceFiles = new Set(['resources/solopi-recording/SoloPi.apk','resources/solopi-recording/manifest.json','resources/solopi-recording/LICENSE.txt','resources/solopi-recording/NOTICE.md','resources/branding/SoloPi-LICENSE.txt','resources/branding/NOTICE.md','resources/bin/solopi-desktop','resources/bin/glassbox','resources/team-config.example.json','resources/media-runtime/README.md','resources/branding/solopi-desktop-app-icon.png','resources/branding/solopi-desktop-icon-source.png','resources/branding/solopi-desktop-hero.png']);
export function isPublicSourceFile(relative) {
  const name = relative.replaceAll('\\', '/');
  if (name.split('/').some((part) => part.startsWith('.') && !rootFiles.has(name))) return false;
  if (name === 'resources/third-party/ffmpeg-sources.json') return true;
  if (rootFiles.has(name) || docs.has(name) || resourceFiles.has(name)) return true;
  if (name.startsWith('resources/third-party/npm-supplements/')) return /\.(?:json|txt)$/.test(name);
  if (name.startsWith('tests/')) return testFiles.has(name.slice(6)) || ['tests/third-party-notices.test.mjs','tests/ffmpeg-source-distribution.test.mjs'].includes(name);
  if (name.startsWith('skills/')) return name.startsWith('skills/solopi-desktop-cli/');
  if (name.startsWith('src/')) return /\.(?:tsx?|vue|css|png|jpe?g|svg|d\.ts)$/.test(name);
  if (name.startsWith('electron/')) return /\.(?:js|mjs|json|d\.ts)$/.test(name);
  if (name.startsWith('scripts/')) return /\.(?:mjs|cjs|sh)$/.test(name) || name === 'scripts/completions/_solopi-desktop-package';
  return false;
}
// Domain suffixes here are rejection rules, never application defaults or targets.
const privateReferences = /(?:https?:\/\/[^\s"'<>]*\b(?:alipay\.com|alipayobjects\.com|antfin\.com|antgroup-inc\.(?:cn|com)|atatech\.org)|\/Users\/[^/\s]+\/|\/home\/(?!user(?:\/|\b))[^/\s]+\/|\b(?:10\.\d+|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,})/i;
export function checkPublicFile(relative, bytes) {
  if (relative === 'resources/solopi-recording/SoloPi.apk') {
    const manifest = JSON.parse(fs.readFileSync(new URL('../resources/solopi-recording/manifest.json', import.meta.url), 'utf8'));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw Error('Bundled public SoloPi APK checksum mismatch');
    return; // Narrow exception for this checksum-pinned official public APK only.
  }
  if (/\.(?:png|jpe?g)$/.test(relative)) return;
  if (relative === 'scripts/export-public-source.mjs') return; // Rejection policy includes private suffix names.
  if (privateReferences.test(bytes.toString('utf8'))) throw Error('Private reference or credential candidate in public source: ' + relative);
}
export function listPublicFiles(root = sourceRoot) {
  const files = [];
  function walk(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) { if (isPublicSourceFile(name)) throw Error('Public source cannot contain symlinks: ' + name); continue; }
      if (entry.isDirectory()) {
        if (!relative && !['src','electron','scripts','skills','tests','docs','resources'].includes(entry.name)) continue;
        if (name === 'skills' || name.startsWith('skills/solopi-desktop-cli') || !name.startsWith('skills/')) {
          if (!entry.name.startsWith('.') && !['node_modules','build','release','dist'].includes(entry.name)) walk(path.join(directory,entry.name),name);
        }
      } else if (isPublicSourceFile(name)) files.push(name);
    }
  }
  walk(root);
  return files.sort();
}
export function exportPublicSource(destination, root = sourceRoot) {
  const output = path.resolve(destination);
  if (fs.existsSync(output)) throw Error('Public source destination must not exist');
  // Validate everything before creating an output directory; report paths, never matching values.
  const files = listPublicFiles(root);
  const entries = files.map((name) => {
    const bytes = fs.readFileSync(path.join(root,name)); checkPublicFile(name,bytes);
    return {path: name,sha256: crypto.createHash('sha256').update(bytes).digest('hex'),bytes: bytes.length};
  });
  fs.mkdirSync(output,{recursive:true});
  for (const {path: name} of entries) { fs.mkdirSync(path.dirname(path.join(output,name)),{recursive:true}); fs.copyFileSync(path.join(root,name),path.join(output,name)); }
  fs.writeFileSync(path.join(output,'.gitignore'),'node_modules/\ndist/\nbuild/\nrelease/\n.private-local/\n*.local\n');
  fs.writeFileSync(path.join(output,'PUBLIC_SOURCE_MANIFEST.json'),JSON.stringify({schemaVersion:1,license:'Apache-2.0',licenseFile:'LICENSE',thirdPartyNoticesFile:'THIRD_PARTY_NOTICES.md',files:entries},null,2)+'\n');
  return {success:true,files:entries.length,destination:output,containsGitHistory:false,containsBundledBinaries:entries.some(entry=>entry.path==='resources/solopi-recording/SoloPi.apk'),containsMediaRuntimeBinaries:false};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: node scripts/export-public-source.mjs <new-directory>');
  console.log(JSON.stringify(exportPublicSource(process.argv[2]),null,2));
}
