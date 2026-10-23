import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { verifyRetiredCapturePage } from '../scripts/verify-retired-capture-page.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const commonSitesSource = read('../src/components/CommonSitesPage.tsx');
const settingsSource = read('../src/components/CommonSitesSettings.tsx');
const siteModelSource = read('../src/lib/commonSites.ts');
const sidebarSource = read('../src/components/Sidebar.tsx');
const workflowEditorSource = read('../src/components/WorkflowEditor.tsx');
const sharedWebviewSource = read('../src/components/SharedEmbeddedWebview.tsx');

test('common sites replace both factories and preserve one shared persistent webview', () => {
  assert.match(siteModelSource, /DEFAULT_COMMON_SITES: CommonSite\[\] = \[\]/);
  assert.doesNotMatch(siteModelSource, /EMBEDDED_BUSINESS_AUTH_TARGETS|private-help-host/);
  assert.match(commonSitesSource, /<SharedEmbeddedWebview/);
  assert.match(sharedWebviewSource, /persist:data-factory/);
  assert.equal((sharedWebviewSource.match(/<webview/g) || []).length, 1);
  assert.doesNotMatch(commonSitesSource, /partition=/);
  assert.match(sidebarSource, /id: 'sites', label: '常用站点'/);
  assert.doesNotMatch(sidebarSource, /id: 'samples'|id: 'data'/);
  assert.match(workflowEditorSource, /activeTab === 'sites'/);
  assert.match(workflowEditorSource, /<CommonSitesPage \/>/);
  assert.match(workflowEditorSource, /<CommonSitesSettings \/>/);
});

test('removed image carousel cannot re-enter the common sites bundle', () => {
  assert.doesNotMatch(commonSitesSource, /码图片轮播|indexedDB|carousel/i);
  assert.doesNotMatch(siteModelSource, /码图片轮播|indexedDB|carousel/i);
  assert.doesNotMatch(workflowEditorSource, /DataFactoryPage|SampleFactoryPage|dataFactoryFloatMode/);
  assert.match(settingsSource, /所有站点继续共用 solopi-desktop 的登录会话/);
});

test('shared webview ignores redirect aborts and subframe failures', () => {
  assert.match(sharedWebviewSource, /event\.errorCode === -3/);
  assert.match(sharedWebviewSource, /event\.isMainFrame === false/);
  assert.match(sharedWebviewSource, /did-fail-load/);
});

test('sidebar does not embed an external help destination', () => {
  assert.doesNotMatch(sidebarSource, /HELP_CENTER_URL|openHelpCenter/);
});

test('capture page is removed from both renderers and its backend IPC', () => {
  for (const file of ['../src/components/MockPage.tsx', '../src/components/MockPage.vue']) {
    assert.equal(existsSync(new URL(file, import.meta.url)), false);
  }
  for (const file of ['../src/components/Sidebar.tsx', '../src/components/Sidebar.vue', '../src/App.vue', '../src/components/WorkflowEditor.tsx', '../electron/main.js', '../electron/preload.js']) {
    assert.doesNotMatch(read(file), /MockPage|adb:prepare-mock-page|抓包与\s*(?:MOCK|Mock|mock)/u);
  }
  assert.doesNotMatch(read('../electron/main.js'), /waitForDebugServerForwardReady|checkLocalDebugServerReady/);
});

test('artifact guard rejects stale renderer or backend, while retaining generic image mock', () => {
  const clean = { 'electron/main.js': '', 'electron/preload.js': '', 'dist/bundle.js': '图片 Mock image_mock' };
  assert.doesNotThrow(() => verifyRetiredCapturePage(file => clean[file]));
  for (const file of Object.keys(clean)) {
    assert.throws(() => verifyRetiredCapturePage(name => name === file ? 'adb:prepare-mock-page' : clean[name]), /Retired capture page/);
  }
  assert.throws(() => verifyRetiredCapturePage(file => file === 'dist/bundle.js' ? '抓包与MOCK' : ''), /Retired capture page/);
  for (const file of ['../scripts/verify-packaged-app.mjs', '../scripts/verify-linux-package.mjs']) {
    assert.match(read(file), /verifyRetiredCapturePage\(file => asar.extractFile/);
  }
  assert.match(workflowEditorSource, /image_mock/);
});
