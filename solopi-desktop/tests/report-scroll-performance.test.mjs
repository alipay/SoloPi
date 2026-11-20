import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = file => ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
vm.runInNewContext(compile('../src/lib/report-thumbnail-store.ts'), { exports, performance });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('100 report thumbnails never exceed three in flight; duplicates share a read', async () => {
  const store = exports.createReportThumbnailStore();
  let active = 0, peak = 0, reads = 0;
  const releases = [];
  const read = () => new Promise(resolve => {
    reads++; peak = Math.max(peak, ++active);
    releases.push(() => { active--; resolve({success:true,dataUrl:'thumbnail'}); });
  });
  let delivered = 0;
  for (let i = 0; i < 100; i++) store.subscribe(`image-${i}`, read, () => delivered++);
  store.subscribe('image-0', read, () => delivered++);
  await flush(); assert.equal(reads, 3);
  while (delivered < 101) { releases.splice(0).forEach(release => release()); await flush(); }
  assert.equal(peak, 3); assert.equal(reads, 100);
});

test('offscreen/unmounted thumbnails cancel queued work and ignore late in-flight results', async () => {
  const store = exports.createReportThumbnailStore(1, 2);
  let release, queuedReads = 0, deliveries = 0;
  const cancel = store.subscribe('active', () => new Promise(resolve => { release = resolve; }), () => deliveries++);
  const cancelQueued = store.subscribe('queued', async () => { queuedReads++; return { success:true,dataUrl:'queued' }; }, () => deliveries++);
  await flush(); cancel(); cancelQueued(); release({success:true,dataUrl:'late'}); await flush();
  assert.equal(deliveries, 0); assert.equal(queuedReads, 0);
  let reads = 0;
  store.subscribe('active', async () => { reads++; return {success:true,dataUrl:'new'}; }, () => {});
  await flush(); assert.equal(reads, 1);
});

test('bounded LRU cache evicts old thumbnails and failed reads can recover', async () => {
  const store = exports.createReportThumbnailStore(1, 2);
  let reads = 0;
  const read = async path => { reads++; return {success:true,dataUrl:path}; };
  for (const path of ['a','b','a','c','a','b']) { store.subscribe(path, read, () => {}); await flush(); }
  assert.equal(reads, 4);
  let attempts = 0, value;
  const failing = async () => { if (++attempts === 1) throw Error('gone'); return {success:true,dataUrl:'recovered'}; };
  store.subscribe('failed', failing, v => value = v); await flush(); assert.equal(value, '');
  store.subscribe('failed', failing, v => value = v); await flush(); assert.equal(value, 'recovered');
});

function viewport() {
  const slots = [], pending = []; let cursor = 0, intersection, resize, disconnected = 0;
  const element = { getBoundingClientRect: () => ({height:740}) };
  const hooks = {
    useRef(value) { const i=cursor++; return slots[i] ?? (slots[i]={current:value}); },
    useState(value) { const i=cursor++; if (!(i in slots)) slots[i]=value; return [slots[i], v => {slots[i]=v;}]; },
    useEffect(fn,deps) { const i=cursor++, old=slots[i]; if (!old || deps.some((d,j)=>d!==old.deps[j])) {old?.cleanup?.(); slots[i]={deps}; pending.push(()=>{slots[i].cleanup=fn();});} },
  };
  const jsx = (type,props) => ({type,props}); const out={};
  vm.runInNewContext(compile('../src/components/ReportViewport.tsx'), { exports:out,
    require:name => name==='react'?hooks:{jsx,jsxs:jsx},
    IntersectionObserver:class { constructor(fn) {intersection=fn;} observe() {} disconnect(){disconnected++;} },
    ResizeObserver:class { constructor(fn) {resize=fn;} observe() {} disconnect() {} },
  });
  return {
    render(children) {cursor=0;const tree=out.default({label:'case',children,estimate:300});tree.props.ref.current=element;while(pending.length)pending.shift()();return tree;},
    intersect(visible) {intersection([{target:element,isIntersecting:visible}]);},
    resize() {resize();}, dispose() {slots.forEach(s=>s?.cleanup?.());},
    disconnected:()=>disconnected,
  };
}

test('offscreen cases do not build details; leaving viewport releases content and preserves measured height', () => {
  const row=viewport(); let rendered=0;
  const render=()=>{rendered++;return 'heavy details';};
  assert.equal(row.render(render).props.style.height,300); assert.equal(rendered,0);
  row.intersect(true); assert.equal(row.render(render).props.children,'heavy details');
  row.resize(); row.intersect(false);
  assert.equal(row.render(render).props.style.height,740); assert.equal(rendered,1);
  row.render(render); assert.equal(rendered,1); // task updates while offscreen
  row.intersect(true); row.render(render); assert.equal(rendered,2);
  row.dispose(); assert.equal(row.disconnected(),1);
});

test('report integration keeps filtering over all records, uses on-demand thumbnails and preserves original-image action', () => {
  const editor=fs.readFileSync(new URL('../src/components/WorkflowEditor.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(editor,/Promise\.all\(missingPaths|screenshotPreviewUrls/);
  assert.match(editor,/selectedTaskCases\.map\(\(caseRecord, caseIndex\) => \(\{ caseRecord, caseIndex \}\)\)\.filter/);
  assert.match(editor,/ReportViewport key=\{\x60\$\{selectedTask.id\}:\$\{caseRecord.caseId\}:\$\{caseIndex\}/);
  assert.match(editor,/openPathInFolder\(screenshot.path, 'open'\)/);
  const image=fs.readFileSync(new URL('../src/components/ReportScreenshot.tsx',import.meta.url),'utf8');
  assert.match(image,/maxDimension: 512/); assert.match(image,/cancelled = true; unsubscribe\(\)/);
});

test('isolated Electron renderer: 100 cases stay bounded while scrolling, refreshing and filtering', {timeout:45000}, async t => {
  const {createRequire} = await import('node:module');
  const {spawnSync} = await import('node:child_process');
  const os = await import('node:os'); const path = await import('node:path');
  if (process.platform === 'linux' && !process.env.DISPLAY) return t.skip('Electron renderer requires a display');
  const require = createRequire(import.meta.url);
  const electron = require('electron');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'solopi-report-scroll-'));
  try {
    const modules = Object.fromEntries(['ReportViewport','ReportScreenshot'].map(name => [name,compile(`../src/components/${name}.tsx`)]));
    modules.store = compile('../src/lib/report-thumbnail-store.ts');
    modules.language = compile('../src/language.ts');
    const react = require.resolve('react'), client = require.resolve('react-dom/client');
    const renderer = `
const nodeRequire=require;
const React=nodeRequire(${JSON.stringify(react)}), {createRoot}=nodeRequire(${JSON.stringify(client)});
const registry=${JSON.stringify(modules)};
function load(key){const out={};new Function('require','exports',registry[key])((name)=>name==='../lib/report-thumbnail-store'?load('store'):name==='../language'?load('language'):nodeRequire(name.startsWith('react')?${JSON.stringify(path.dirname(react))}+(name==='react'?'':name.slice(5)):name),out);return out;}
const Viewport=load('ReportViewport').default, Image=load('ReportScreenshot').default;
const store=load('store').createReportThumbnailStore();
const e=React.createElement, root=createRoot(document.getElementById('root'));
let reads=0,opened='',records=Array.from({length:100},(_,i)=>i);
const invoke=async()=>{reads++;return {success:true,dataUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="512"/>'};};
function render(){root.render(e('div',{},records.map(i=>e(Viewport,{key:i,label:'case-'+i,estimate:700},()=>e('article',{style:{height:700},'data-case':i},e('button',{onClick:()=>opened='case-'+i},'open case'),e('div',{style:{display:'flex',overflowX:'auto',width:900,height:360}},Array.from({length:6},(_,j)=>e('button',{key:j,style:{width:260,minWidth:260,height:360},onClick:()=>opened=i+'-'+j},e(Viewport,{label:'image',estimate:360,className:'fill'},()=>e(Image,{path:i+'-'+j,index:j,store,invoke}))))))))));}
const wait=()=>new Promise(resolve=>setTimeout(resolve,180));
(async()=>{render();await wait();await wait();
const initial=document.querySelectorAll('article').length;
if(initial<1||initial>5)throw Error('unbounded initial cases '+initial);
if(reads<1||reads>24)throw Error('unbounded initial screenshots '+reads);
for(let i=0;i<10;i++)render();await wait();const readBefore=reads;render();await wait();if(reads!==readBefore)throw Error('task update re-read images');
const scroll=document.getElementById('root');scroll.scrollTop=42000;await wait();await wait();
if(document.querySelectorAll('article').length>6)throw Error('unbounded scrolled cases');
if(!document.querySelector('[data-case="60"]'))throw Error('scroll target missing');
const heightBefore=scroll.scrollHeight;scroll.scrollTop=0;await wait();await wait();
if(Math.abs(scroll.scrollHeight-heightBefore)>20)throw Error('lost measured scroll height');
records=[99];render();await wait();scroll.scrollTop=0;await wait();await wait();
const button=document.querySelector('[data-case="99"] button');if(!button)throw Error('filter lost target');button.click();if(opened!=='case-99')throw Error('case action broken');
const screenshots=document.querySelectorAll('[data-case="99"] button');screenshots[1].click();if(opened!=='99-0')throw Error('image action broken');
nodeRequire('electron').ipcRenderer.send('result',{initialCases:initial,finalCases:document.querySelectorAll('article').length,thumbnailReads:reads});
})().catch(error=>nodeRequire('electron').ipcRenderer.send('result',{error:String(error.stack)}));`;
    fs.writeFileSync(path.join(directory,'renderer.cjs'),renderer);
    fs.writeFileSync(path.join(directory,'index.html'),`<style>body{margin:0}.fill{height:100%;width:100%}img{max-height:100%;max-width:100%}</style><div id="root" style="height:600px;overflow:auto;width:1100px"></div><script>require('./renderer.cjs')</script>`);
    fs.writeFileSync(path.join(directory,'main.cjs'),`const {app,BrowserWindow,ipcMain}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(directory,'profile'))});app.whenReady().then(()=>{let win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});win.loadFile(${JSON.stringify(path.join(directory,'index.html'))});ipcMain.once('result',(_event,result)=>{console.log('REPORT_QA:'+JSON.stringify(result));app.exit(result.error?1:0);});setTimeout(()=>{console.log('REPORT_QA:'+JSON.stringify({error:'renderer timed out'}));app.exit(1);},25000);});`);
    const mainPath=path.join(directory,'main.cjs');
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const run=spawnSync(electron,[mainPath],{encoding:'utf8',env,timeout:35000});
    const line=run.stdout?.split('\n').find(value=>value.startsWith('REPORT_QA:'));
    assert.ok(line,run.stderr||run.error?.message||'no renderer receipt');
    const result=JSON.parse(line.slice('REPORT_QA:'.length));
    assert.equal(result.error,undefined,result.error);assert.equal(run.status,0,run.stderr);
    assert.equal(result.finalCases,1);t.diagnostic(JSON.stringify(result));
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
