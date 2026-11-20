#!/usr/bin/env node
// Explicit source boundary: never export a checkout, Git metadata or runtime state.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const PUBLIC_SKILLS = Object.freeze(['solopi-desktop-cli', 'solopi-lab-task-ops', 'solopi-lab-agent']);
export const PUBLIC_SKILL_PRIVATE_CONTENT = /(?:antmultica|(?:^|[^a-z0-9])(?:afts|multica)(?:$|[^a-z0-9])|\bdima\b|\bhuoban\b|\bantcode\b|\bpoolab\b|\bcodefuse\b|伙伴提测|工号|submitWorkNo|registration\.submissions|solopi-lab-agent\s+(?:submit|status)|glass_biz_config\.json|ACTION_SCANPAY|GPK_|bundle-galipay|(?:alipay\.(?:com|net)|antfin\.com|antgroup-inc\.(?:cn|com)|atatech\.org)|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,})/i;
export const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function publicSourcePath(root, name) {
  if (!fs.existsSync(path.join(root, 'lab-server')) && fs.existsSync(path.join(root, '../solopi-lab-server/package.json'))) {
    const server = path.resolve(root, '../solopi-lab-server');
    for (const [prefix, target] of [['lab-server/', ''], ['lab-web/', 'web/'], ['contracts/', 'contracts/'], ['deploy/', 'deploy/'], ['integrations/', 'integrations/']]) {
      if (name.startsWith(prefix)) return path.join(server, target, name.slice(prefix.length));
    }
  }
  return path.join(root, name);
}
const rootFiles = new Set(['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','README.md','package.json','package-lock.json','webpack.config.js','webpack.report-viewer.cjs','tsconfig.json','postcss.config.js','tailwind.config.js','components.json','index.html','.gitattributes','.npmrc']);
const testFiles = new Set(['desktop-virtual-upstream-compat.test.mjs','upstream-agent-model-step-recovery.test.mjs','upstream-agent-progress-policy.test.mjs','upstream-agent-skill-refresh.test.mjs','security-dev-server.test.mjs','upstream-request-settings.test.mjs','dependency-security-regressions.test.mjs','repository-layout.test.mjs','fixtures/github-layout.json','fixtures/dependency-advisories.json','dependency-security.test.mjs','case-graph.test.mjs','case-update.test.mjs','runtime-registry.test.mjs','local-runtime-model.test.mjs','runtime-wire-compatibility.test.mjs','message-reply-integration.test.mjs','message-reply-engine.test.mjs','message-reply-model.test.mjs','harness-control.test.mjs','message-reply-notification-boundaries.test.mjs','message-reply-fixture.test.mjs','github-harness-integration.test.mjs','reply-evidence-store.test.mjs','reply-evidence-preload.test.mjs','reply-knowledge.test.mjs','message-reply-image-capability.test.mjs','message-reply-store.test.mjs','virtual-recovery-store.test.mjs','message-reply-redirect.test.mjs','packaged-harness.test.mjs','virtual-tools.test.mjs','reply-settings.test.mjs','virtual-recovery-record-ipc.test.mjs','reply-start-confirmation.test.mjs','message-reply-task.test.mjs','support-export.test.mjs','harness-request-control.test.mjs','harness-request-recovery.test.mjs','harness-runtime.test.mjs','agent-case-review.test.mjs','team-configuration-renderer.cjs','team-configuration-renderer.test.mjs','team-configuration-cli.test.mjs','team-configuration.test.mjs','agent-tool-validation.test.mjs','agent-drafts.test.mjs','agent-message-images.test.mjs','report-detail-loading.test.mjs','report-scroll-performance.test.mjs','report-performance-diagnostics.test.mjs','workflow-parallel-screenshot.test.mjs','workflow-editor-layout.test.mjs','case-library-banner.test.mjs','performance-export.test.mjs','solopi-permissions.test.mjs','solopi-recording-recovery.test.mjs','solopi-native-replay.test.mjs','solopi-stop-convert.test.mjs','recording-dialog-ui.test.mjs','workflow-assertion-policy.test.mjs','workflow-execution-summary.test.mjs','component-configuration-compatibility.test.mjs','case-scope-selection.test.mjs','solopi-provider.test.mjs','quick-action-template-audit.test.mjs','cli-headless-runtime.test.mjs','agent-skill-renames.test.mjs','agent-experience-memory.test.mjs','preview-performance-regression.test.mjs','cli-case-list-projection.test.mjs','case-edit-refresh-regression.test.mjs','case-edit-guard.test.mjs','public-source.test.mjs','public-progress-boundary.test.mjs','receipt-timing.test.mjs','operation-receipts.test.mjs','agent-evidence-pagination.test.mjs','packaged-task-query.test.mjs','public-skills-boundary.test.mjs','public-callback-boundary.test.mjs','retired-app-update.test.mjs','device-preflight.test.mjs','workflow-editor-image-mock.test.mjs','sample-factory-navigation.test.mjs','agent-skill-refresh.test.mjs','solopi-import.test.mjs','task-result-delivery.test.mjs','agent-model-step-recovery.test.mjs','glasses-device-contract.test.mjs','agent-progress-policy.test.mjs','agent-skill-scope.test.mjs','agent-case-evidence-export.test.mjs','platform-tool-parity.test.mjs','quick-action-cli.test.mjs','task-cleanup.test.mjs','model-transport-trace.test.mjs','case-library-pull-ownership.test.mjs','development-tasks.test.mjs','task-visibility.test.mjs','fixtures/native-harness.mjs','fixtures/harness-lifecycle.mjs','fixtures/node-broker.mjs']);
const docs = new Set(['docs/DEPENDENCY_SECURITY.md','docs/local-runtime-configuration.md','docs/THREE_PLATFORM_CONTROL.md','docs/android-virtual-agent.md','docs/REPORT_PERFORMANCE.md','docs/cluster-client.md','docs/PARALLEL_LISTENERS.md','docs/CLI_BACKGROUND_RUNTIME.md','docs/configuration.md','docs/agent/glassbox-cli-usage.md','docs/agent/MODEL_REQUEST_RECOVERY.md','docs/public-source.md','docs/SOLOPI_IMPORT.md']);
const resourceFiles = new Set(['resources/solopi-recording/SoloPi.apk','resources/solopi-recording/manifest.json','resources/solopi-recording/LICENSE.txt','resources/solopi-recording/NOTICE.md','resources/branding/SoloPi-LICENSE.txt','resources/branding/NOTICE.md','resources/bin/solopi-desktop','resources/bin/glassbox','resources/team-config.example.json','resources/media-runtime/README.md','resources/branding/solopi-desktop-app-icon.png','resources/branding/solopi-desktop-icon-source.png','resources/branding/solopi-desktop-hero.png']);
export function isPublicSourceFile(relative) {
  const name = relative.replaceAll('\\', '/');
  if (/(?:^|\/)(?:antmultica|multica|afts)(?:[./-]|$)/i.test(name)) return false;
  if (name.split('/').some((part) => part.startsWith('.') && !rootFiles.has(name) && name !== 'lab-web/.npmrc')) return false;
  if (name === 'resources/third-party/ffmpeg-sources.json') return true;
  if (rootFiles.has(name) || docs.has(name) || resourceFiles.has(name)) return true;
  if (name.startsWith('lab-server/')) {
    const file = name.slice('lab-server/'.length);
    return ['package.json','package-lock.json','src/package.json','docs/PUBLIC_USAGE.md','docs/SELF_HOSTING.md'].includes(file)
      || /^(?:src|scripts)\/.+\.(?:mjs|cjs|js)$/.test(file)
      || /^src\/desktop-agent\/(?:package|SOURCE)\.json$/.test(file)
      || /^migrations\/\d+_[\w-]+\.sql$/.test(file)
      || /^test\/(?:public-fixtures|generic-integrations|public-usage-skill|lab-routes|hardening|attachment-file-transfer|client-result-failures|tool-contract-examples|lab-platform|host-cli-receipts|host-cli-observation|request-timing|request-timing-integration|case-write-receipts|model-credentials|gateway-listen-options)\.test\.mjs$/.test(file);
  }
  if (name.startsWith('lab-web/')) {
    const file = name.slice('lab-web/'.length);
    return ['package.json','package-lock.json','.npmrc','index.html','tsconfig.json','vite.config.ts'].includes(file)
      || /^src\/.+\.(?:tsx?|css|svg|png|jpe?g)$/.test(file)
      || /^scripts\/[\w-]+\.mjs$/.test(file)
      || /^test\/(?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|mjs|cjs|json)$/.test(file);
  }
  if (name.startsWith('contracts/')) return /^contracts\/v\d+\.\d+\.\d+\/schemas\/.+\.json$/.test(name);
  if (['deploy/stage-a/httpview.mjs','deploy/stage-a/cp-request-body.mjs'].includes(name)) return true;
  if (name.startsWith('integrations/solopi-lab/')) {
    const file = name.slice('integrations/solopi-lab/'.length);
    return ['README.md','pyproject.toml','agent-instructions.md'].includes(file)
      || /^(?:solopi_lab|tests)\/.+\.py$/.test(file) && !file.includes('/__pycache__/')
      || /^examples\/[\w.-]+\.(?:json|service)$/.test(file);
  }
  if (name === 'tests/public-server-package.test.mjs') return true;
  if (name.startsWith('resources/device-harness/')) return !name.includes('/__pycache__/') && (/\.py$/.test(name) || name.includes('/solopi_harness/resources/') || name.endsWith('/NOTICE.md'));
  if (name.startsWith('resources/third-party/npm-supplements/')) return /\.(?:json|txt)$/.test(name);
  if (name.startsWith('tests/')) return testFiles.has(name.slice(6)) || ['tests/third-party-notices.test.mjs','tests/ffmpeg-source-distribution.test.mjs'].includes(name);
  if (name.startsWith('skills/')) return PUBLIC_SKILLS.some(skill => name.startsWith('skills/' + skill + '/'));
  if (name.startsWith('src/')) return /\.(?:tsx?|vue|css|png|jpe?g|svg|d\.ts)$/.test(name);
  if (name.startsWith('vendor/picomatch/')) return /^(?:vendor\/picomatch\/(?:index\.js|package\.json|LICENSE|README\.md|SECURITY_PATCH\.md|patch-provenance\.json)|vendor\/picomatch\/lib\/[a-z-]+\.js)$/.test(name);
  if (name.startsWith('electron/')) return /\.(?:js|mjs|cjs|json|d\.ts)$/.test(name);
  if (name.startsWith('scripts/')) return /\.(?:mjs|cjs|sh)$/.test(name) || name === 'scripts/completions/_solopi-desktop-package';
  return false;
}
// Domain suffixes here are rejection rules, never application defaults or targets.
const privateReferences = /(?:https?:\/\/[^\s"'<>]*\b(?:alipay\.com|alipayobjects\.com|antfin\.com|antgroup-inc\.(?:cn|com)|atatech\.org)|\/Users\/[^/\s]+\/|\/home\/(?!user(?:\/|\b))[^/\s]+\/|\b(?:10\.\d+|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,})/i;
// Keep private provider integrations out of exported bytes while preserving a
// resolvable module and an actionable error for unsupported public runtimes.
export function publicSourceBytes(relative, bytes) {
  return bytes;
}
export function checkPublicFile(relative, bytes) {
  if (relative.startsWith('skills/') && PUBLIC_SKILL_PRIVATE_CONTENT.test(bytes.toString('utf8'))) throw Error('Private content candidate in public Skill: ' + relative);
  if (relative === 'resources/solopi-recording/SoloPi.apk') {
    const manifest = JSON.parse(fs.readFileSync(new URL('../resources/solopi-recording/manifest.json', import.meta.url), 'utf8'));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw Error('Bundled public SoloPi APK checksum mismatch');
    return; // Narrow exception for this checksum-pinned official public APK only.
  }
  if (/\.(?:png|jpe?g)$/.test(relative)) return;
  if (relative === 'scripts/export-public-source.mjs') return; // Rejection policy includes private suffix names.
  // Negative fixtures may name rejected providers; shipped runtime and dependencies may not.
  if (!/(?:^|\/)(?:tests?|test-fixtures)(?:\/|$)/.test(relative) && /(?:antmultica|(?:^|[^a-z0-9])(?:multica|afts)(?:$|[^a-z0-9]))/i.test(bytes.toString('utf8'))) throw Error('Private platform dependency in public source: ' + relative);
  if (privateReferences.test(bytes.toString('utf8'))) throw Error('Private reference or credential candidate in public source: ' + relative);
}
export function listPublicFiles(root = sourceRoot) {
  const files = [];
  function walk(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) { if (isPublicSourceFile(name)) throw Error('Public source cannot contain symlinks: ' + name); continue; }
      if (entry.isDirectory()) {
        if (!relative && !['src','electron','scripts','skills','tests','docs','resources','vendor','lab-server','lab-web','contracts','deploy','integrations'].includes(entry.name)) continue;
        if (['lab-server/data','lab-web/.desktop-source','lab-web/.desktop-ui','lab-web/.desktop-lib','lab-web/.desktop-lucide'].includes(name)) continue;
        if (relative === 'integrations' && entry.name !== 'solopi-lab') continue;
        if (relative === 'deploy' && entry.name !== 'stage-a') continue;
        if (name === 'skills' || PUBLIC_SKILLS.some(skill => name === 'skills/' + skill || name.startsWith('skills/' + skill + '/')) || !name.startsWith('skills/')) {
          if (!entry.name.startsWith('.') && !['node_modules','build','release','dist'].includes(entry.name)) walk(path.join(directory,entry.name),name);
        }
      } else if (isPublicSourceFile(name)) files.push(name);
    }
  }
  walk(root);
  if (!fs.existsSync(path.join(root, 'lab-server')) && fs.existsSync(path.join(root, '../solopi-lab-server/package.json'))) {
    const server = path.resolve(root, '../solopi-lab-server');
    for (const [physical, logical] of [['', 'lab-server'], ['web', 'lab-web'], ['contracts', 'contracts'], ['deploy', 'deploy'], ['integrations', 'integrations']]) {
      // The server walk only accepts its source allowlist; Web/contracts use
      // their own logical prefixes so generated output is never selected.
      if (fs.existsSync(path.join(server, physical))) walk(path.join(server, physical), logical);
    }
  }
  return [...new Set(files)].sort();
}
export function publicSourceDigest(root = sourceRoot) {
  const hash = crypto.createHash('sha256');
  for (const name of listPublicFiles(root)) hash.update(name).update('\0').update(fs.readFileSync(publicSourcePath(root,name))).update('\0');
  return hash.digest('hex');
}
export function exportPublicSource(destination, root = sourceRoot) {
  const output = path.resolve(destination);
  if (fs.existsSync(output)) throw Error('Public source destination must not exist');
  // Validate everything before creating an output directory; report paths, never matching values.
  const files = listPublicFiles(root);
  const snapshot = new Map();
  const modes = new Map();
  files.forEach((name) => {
    const bytes = publicSourceBytes(name,fs.readFileSync(publicSourcePath(root,name))); checkPublicFile(name,bytes);
    snapshot.set(name,bytes);
    modes.set(name, fs.statSync(publicSourcePath(root,name)).mode & 0o111 ? 0o755 : 0o644);
  });
  fs.mkdirSync(output,{recursive:true});
  for (const [name,bytes] of snapshot) { fs.mkdirSync(path.dirname(path.join(output,name)),{recursive:true}); fs.writeFileSync(path.join(output,name),bytes,{mode:modes.get(name)}); }
  // Generate Server mirrors from this immutable snapshot, never from a live
  // checkout that another developer may be editing during export.
  const sync=path.join(output,'lab-server/scripts/sync-desktop-recovery.mjs');
  if(fs.existsSync(sync)) {
    const result=spawnSync(process.execPath,[sync],{cwd:output,env:{...process.env,SOLOPI_DESKTOP_SOURCE:output},encoding:'utf8'});
    if(result.status!==0)throw Error('Public shared runtime assembly failed: '+result.stderr);
  }
  const entries=listPublicFiles(output).map(name=>{
    const bytes=fs.readFileSync(path.join(output,name));checkPublicFile(name,bytes);
    return {path:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
  });
  fs.writeFileSync(path.join(output,'.gitignore'),'node_modules/\ndist/\nbuild/\nrelease/\n.private-local/\n*.local\n.env\n.env.*\nlab-server/data/\ndeploy/stage-a/data/\ndeploy/stage-a/handoff/\nlab-web/.desktop-*\n__pycache__/\n*.egg-info/\n');
  fs.writeFileSync(path.join(output,'PUBLIC_SOURCE_MANIFEST.json'),JSON.stringify({schemaVersion:1,license:'Apache-2.0',licenseFile:'LICENSE',thirdPartyNoticesFile:'THIRD_PARTY_NOTICES.md',files:entries},null,2)+'\n');
  return {success:true,files:entries.length,destination:output,containsGitHistory:false,containsBundledBinaries:entries.some(entry=>entry.path==='resources/solopi-recording/SoloPi.apk'),containsMediaRuntimeBinaries:false};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: node scripts/export-public-source.mjs <new-directory>');
  console.log(JSON.stringify(exportPublicSource(process.argv[2]),null,2));
}
