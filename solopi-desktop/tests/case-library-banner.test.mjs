import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
const source = fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let renderer, confirm;
function visit(n) {
  if (ts.isVariableDeclaration(n)) {
    if (n.name.getText(tree) === 'renderLocalCaseLibraryChangeBanner') renderer = n.initializer.getText(tree);
    if (n.name.getText(tree) === 'confirmPendingLocalCaseLibraryChange') confirm = n.initializer.getText(tree);
  }
  ts.forEachChild(n, visit);
}
visit(tree);
function harness(selected = 'a') {
  const library = { id: 'a', name: '库 A', repoUrl: 'repo-a', branch: 'main' };
  const ctx = { exports: {}, require: createRequire(import.meta.url), selectedCaseLibraryId: selected,
    pendingLocalCaseLibraryChange: { libraryId: 'a', type: 'library-error', errorCode: 'CASE_LIBRARY_LOCAL_REPO_NOT_FOUND' },
    normalizedCaseLibraries: [library], caseLibrariesRef: { current: [library] }, AlertTriangle: () => 'warning-icon', Info: () => 'info-icon',
    caseLibraryEditorDirtyRef: { current: false }, caseLibraryStatus: '', isPullingCaseLibrary: false, isRefreshingCaseLibrary: false,
    refreshSelectedCaseLibrary: (v) => { ctx.refreshed = v.library.id; },
    pullRemoteCases: async (v) => { ctx.pulled = v.id; return true; },
    setPendingLocalCaseLibraryChange: (v) => { ctx.dismissed = v; }, setGitConfigError: () => {},
    setGitConfigDialog: (v) => { ctx.config = v; }, getConfiguredGitBranch: (v) => v.branch };
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule(`const confirmPendingLocalCaseLibraryChange = ${confirm}; globalThis.render = ${renderer}; globalThis.confirm = confirmPendingLocalCaseLibraryChange;`,
    { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText, ctx);
  return ctx;
}
function buttons(node) { return !node || typeof node !== 'object' ? [] : [...(node.type === 'button' ? [node] : []), ...[node.props?.children].flat(Infinity).flatMap(buttons)]; }
test('unrelated library does not display or retry another library error', () => {
  const ctx = harness('b');
  assert.equal(ctx.render(), null);
  ctx.confirm();
  assert.equal(ctx.refreshed, undefined);
});
test('missing directory offers pull/config on the exact affected library without claiming saved edits', async () => {
  const ctx = harness();
  const view = ctx.render();
  const html = renderToStaticMarkup(view);
  assert.match(html, /库 A/); assert.match(html, /重新拉取/); assert.match(html, /检查配置/);
  assert.match(html, /不表示编辑已保存到磁盘/);
  const actions = buttons(view);
  actions[0].props.onClick();
  await Promise.resolve();
  assert.equal(ctx.pulled, 'a');
  actions[1].props.onClick();
  assert.equal(ctx.config.libraryId, 'a');
  ctx.confirm();
  assert.equal(ctx.refreshed, 'a');
});
test('watcher reports recovery even with unchanged revision', () => {
  const main = fs.readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(main, /result.revision === previousRevision && !localCaseLibraryErrorSignatures.has\(entry.libraryId\)/);
});

test('saved local edits no longer occupy a banner; protection and same-library comparison remain',()=>{
 const ctx=harness();ctx.pendingLocalCaseLibraryChange={libraryId:'a',type:'library-error',errorCode:'CASE_LIBRARY_LOCAL_EDITS_CONFLICT',error:'internal error'};
 assert.equal(ctx.render(),null);
 ctx.confirm();assert.equal(ctx.refreshed,'a');assert.equal(ctx.pulled,undefined);
 assert.ok(source.includes('<CaseLibrarySyncHint'));
 assert.ok(source.includes("pendingLocalCaseLibraryChange?.libraryId === selectedCaseLibraryId"));
 assert.ok(!source.includes('<Zap className="w-4 h-4 text-blue-600 fill-blue-600" />'));
});

const hintFilename = new URL('../src/components/CaseLibrarySyncHint.tsx', import.meta.url);
const hintContext={exports:{},require:createRequire(import.meta.url)};
vm.createContext(hintContext);
vm.runInContext(ts.transpileModule(fs.readFileSync(hintFilename,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText,hintContext);
test('sync icon is collapsed by default, keyboard accessible, and explains differences on demand',()=>{
 let compared=0;
 const view=hintContext.exports.CaseLibrarySyncHint({libraryName:'Library <A>',hasLocalChanges:true,busy:false,onCompare:()=>compared++});
 assert.equal(view.type,'details');assert.equal(view.props.open,undefined);
 const html=renderToStaticMarkup(view);
 assert.match(html,/<summary/);assert.match(html,/aria-label="本地修改未同步，点击查看说明"/);
 assert.match(html,/本地修改已保存/);assert.match(html,/刷新不会覆盖本地修改/);
 assert.match(html,/Library &lt;A&gt;/);assert.doesNotMatch(html,/role="alert"|role="status"|bg-rose-/);
 buttons(view)[0].props.onClick();assert.equal(compared,1);
 const busy=hintContext.exports.CaseLibrarySyncHint({hasLocalChanges:true,busy:true,onCompare:()=>{}});
 assert.equal(buttons(busy)[0].props.disabled,true);
 const normal=hintContext.exports.CaseLibrarySyncHint({hasLocalChanges:false,busy:false,onCompare:()=>{}});
 assert.equal(buttons(normal).length,0);
 assert.doesNotMatch(renderToStaticMarkup(normal),/本地修改未同步|本地修改已保存/);
});
test('genuine file read failures remain alerts with recovery actions',()=>{
 const ctx=harness();ctx.pendingLocalCaseLibraryChange={libraryId:'a',type:'library-error',errorCode:'CASE_LIBRARY_PARSE_ERROR',error:'JSON 文件无法解析'};
 const html=renderToStaticMarkup(ctx.render());assert.match(html,/role="alert"/);assert.match(html,/bg-rose-50/);assert.match(html,/warning-icon/);assert.match(html,/JSON 文件无法解析/);assert.match(html,/重新读取/);assert.match(html,/检查配置/);
});

test('editor changed during refresh is a non-error comparison notice, never a file-repair alert',()=>{
 const ctx=harness();ctx.pendingLocalCaseLibraryChange={libraryId:'a',type:'library-changed',errorCode:'CASE_LIBRARY_EDITOR_CHANGED'};
 const html=renderToStaticMarkup(ctx.render());
 assert.match(html,/页面内容已更新/);assert.match(html,/role="status"/);
 assert.doesNotMatch(html,/role="alert"|本地用例读取失败|请修复文件后重试|bg-rose-/);
});
