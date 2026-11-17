import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const editor = fs.readFileSync(path.join(root, 'src/components/WorkflowEditor.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');

test('WorkflowEditor preserves the original 300-320px configuration column', () => {
  assert.match(editor, /data-testid="workflow-editor-flow-layout"/);
  assert.match(editor, /grid-cols-\[minmax\(0,1fr\)_minmax\(300px,320px\)\]/);
  assert.match(editor, /max-w-\[30vw\]/);
  assert.doesNotMatch(editor, /workflow-editor-flow-layout--with-config/);
  assert.doesNotMatch(styles, /clamp\(360px,\s*34vw,\s*520px\)/);
});

test('WorkflowEditor has no overlay or viewport-width panel rule', () => {
  assert.doesNotMatch(styles, /@media \(max-width:\s*1100px\)/);
  assert.doesNotMatch(styles, /width:\s*min\(440px/);
  assert.doesNotMatch(styles, /\.workflow-editor-config-panel\s*\{[\s\S]*?position:\s*absolute/);
});

test('step configuration content collapses internally within the fixed panel', () => {
  assert.match(editor, /data-testid="workflow-editor-config-panel"/);
  assert.match(editor, /workflow-editor-config-panel min-h-0 min-w-0 w-full max-w-\[30vw\] overflow-x-hidden overflow-y-auto/);
  assert.match(styles, /\.workflow-editor-config-panel \.grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(styles, /\.workflow-editor-config-panel \.flex > \*\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(styles, /\.workflow-editor-config-panel \.justify-between\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(styles, /\.workflow-editor-config-panel textarea,[\s\S]*?white-space:\s*pre-wrap/);
  assert.match(styles, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),[\s\S]*?width:\s*100%/);
  assert.match(editor, /flex min-w-0 flex-col items-stretch gap-2/);
  assert.match(editor, /min-w-0 break-all font-mono text-\[10px\] font-bold leading-4/);
  assert.match(editor, /navigator\.clipboard\?\.writeText\(artifact\.remotePath\)/);
  assert.match(editor, /复制设备路径/);
  assert.match(editor, /line-clamp-2 min-w-0 break-all font-mono text-\[10px\] font-bold leading-4 text-sky-800/);
  assert.match(editor, /line-clamp-2 min-w-0 break-all font-mono text-\[10px\] font-bold leading-4 text-amber-800/);
  assert.match(editor, /mt-1 line-clamp-2 break-all font-mono text-\[10px\] leading-4 text-amber-600/);
});

test('agent and manual mirrors live outside tab content and retain the selected conversation', () => {
  const page = fs.readFileSync(path.join(root, 'src/components/AgentPage.tsx'), 'utf8');
  const sharedLayout = editor.slice(editor.lastIndexOf('</main>'));
  assert.match(sharedLayout, /\{mirrorSessionId && <AgentMirrors sessionId=\{mirrorSessionId\} \/>\}/);
  assert.match(sharedLayout, /<WorkflowMirrors \/>/);
  assert.doesNotMatch(sharedLayout, /activeTab/);
  assert.doesNotMatch(page, /<AgentMirrors/);
  assert.match(editor, /initialSessionId=\{mirrorSessionId\} onSessionChange=\{setMirrorSessionId\}/);
  assert.match(page, /useRef\(initialSessionId\)/);
  assert.match(page, /s\.id === preferredSession\.current/);
  assert.match(page, /if \(session\?\.id\) onSessionChange\(session.id\)/);
});

// Execute the real node-render effect: manual positions must survive subsequent
// status/selection renders, while returning to a case must arrange it again.
const ts = (await import('typescript')).default;
const { createRequire } = await import('node:module');
const { runInNewContext } = await import('node:vm');
const ast = ts.createSourceFile('editor.tsx', editor, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let renderEffect;
function findEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0]?.getText(ast).includes('const isEnteringCase =')) renderEffect = node.arguments[0].getText(ast);
  ts.forEachChild(node, findEffect);
}
findEffect(ast);
function entryHarness() {
  const ctx = {
    workflowRegion:'main',exports:{},require:createRequire(import.meta.url),activeTab:'automation-flow',selectedCase:{id:'a',steps:[{id:'one'}]},
    lastRenderedFlowCaseIdRef:{current:''},reactFlowInstanceRef:{current:null},isReportFlowReadOnly:false,
    flowCaseSnapshot:null,flowCaseEdgesSnapshot:null,caseEdges:{a:[]},runLogs:[],runArtifacts:null,
    runStatuses:{},allWorkflowComponents:[],previewContext:{},parallelHints:{nodes:{}},positions:{},writes:0,
    isNodePosition:position=>Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.y)),
    createWorkflowAutoLayoutPositions:()=>({one:{x:120,y:80}}),ensureBoundaryEdges:()=>[],
    buildWorkflowNodeResultPreviews:()=>({}),
    getCaseNodePositions:()=>ctx.positions[ctx.selectedCase.id] || {one:{x:999,y:999}},
    setNodePositions:update=>{ctx.positions=update(ctx.positions);ctx.writes++;},
    stepsToNodes:(_steps,_statuses,_components,_preview,positions)=>{ctx.visibleStepIds=_steps.map(step=>step.id);return _steps.map(step=>({id:step.id,position:positions[step.id],data:{}}));},
    setNodes:update=>{ctx.nodes=typeof update==='function'?update():update;},
    removeStep:()=>{},window:{requestAnimationFrame:callback=>callback()},
  };
  runInNewContext(ts.transpileModule(`globalThis.renderEffect = ${renderEffect};`,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,ctx);
  return ctx;
}
test('each case visit arranges once; editing and runtime updates preserve manual positions',()=>{
  assert.ok(renderEffect);
  const ctx=entryHarness();ctx.renderEffect();
  assert.equal(ctx.nodes[0].position.x,120);assert.equal(ctx.writes,1);
  ctx.positions.a.one={x:480,y:240};ctx.renderEffect();
  assert.equal(ctx.nodes[0].position.x,480);assert.equal(ctx.writes,1);
  ctx.activeTab='automation-cases';ctx.renderEffect();
  ctx.activeTab='automation-flow';ctx.renderEffect();
  assert.equal(ctx.nodes[0].position.x,120);assert.equal(ctx.writes,2);
  ctx.selectedCase={id:'b',steps:[{id:'one'}]};ctx.renderEffect();
  assert.equal(ctx.writes,3);assert.equal(ctx.positions.a.one.x,120);assert.equal(ctx.positions.b.one.x,120);
});
test('opening a read-only report never writes layout positions back into a case',()=>{
  const ctx=entryHarness();ctx.isReportFlowReadOnly=true;ctx.renderEffect();
  assert.equal(ctx.writes,0);
  assert.match(editor,/reactFlowInstanceRef.current = instance;\s+restoreWorkflowCanvasAfterLayout\(\);/);
});

test('business and final canvases show separate nodes without changing stored phases',()=>{
 const ctx=entryHarness();ctx.selectedCase.steps=[{id:'one'},{id:'cleanup',phase:'cleanup'}];
 const before=JSON.stringify(ctx.selectedCase);ctx.renderEffect();assert.deepEqual(Array.from(ctx.visibleStepIds),['one']);
 ctx.workflowRegion='cleanup';ctx.renderEffect();assert.deepEqual(Array.from(ctx.visibleStepIds),['cleanup']);
 assert.equal(JSON.stringify(ctx.selectedCase),before);
});
