import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createReportPerformanceRecorder}=require('../electron/report-performance-diagnostics');
const {sanitize}=require('../electron/diagnostics');
const out={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/report-performance.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:out,performance});

test('report session aggregates stalls and commits, suppresses idle samples, closes once',()=>{
 let time=0;const events=[];let hits=0;
 const s=out.createReportPerformanceSession({taskId:'task-one',emit:e=>events.push(e),snapshot:()=>({thumbnailCacheHits:hits}),now:()=>time});
 assert.equal(events[0].stage,'open');assert.equal(events[0].renderSampleCount,0);assert.equal(events[0].renderMs,undefined);
 s.sample();assert.equal(events.length,1);s.commit(70);s.commit(5);s.longTask(80);s.longTask(49);
 time=10000;s.sample();assert.equal(events.length,2);assert.equal(events[1].maxRenderMs,70);assert.equal(events[1].renderMs,75);assert.equal(events[1].longTaskCount,1);assert.equal(events[1].durationMs,10000);
 s.sample();assert.equal(events.length,2);hits++;s.sample();assert.equal(events.length,3);
 s.close();s.close();s.commit(500);s.sample();assert.equal(events.length,4);assert.equal(events[3].stage,'close');
});
test('diagnostic delivery failures cannot interrupt report processing',()=>{
 const s=out.createReportPerformanceSession({taskId:'task',emit:()=>{throw Error('IPC gone');},snapshot:()=>({}),now:()=>0});
 assert.doesNotThrow(()=>{s.commit(10);s.sample();s.close();});
 assert.doesNotThrow(()=>out.createReportPerformanceSession({taskId:'task',emit:()=>{},snapshot:()=>{throw Error('detached');}}));
 const record=createReportPerformanceRecorder({record:()=>{throw Error('disk full');}});
 assert.equal(record({sender:{}},{taskId:'task',stage:'open'}).errorCode,'REPORT_DIAGNOSTIC_WRITE_FAILED');
});
test('IPC validates and strips raw paths, screenshot data and untrusted event names; export retains approved metrics',()=>{
 const events=[],sender={};const record=createReportPerformanceRecorder({record:e=>events.push(sanitize(e))});
 assert.equal(record({sender},{taskId:'task-1',stage:'sample',event:'malicious',thumbnailReads:3,thumbnailFailures:1,maxLongTaskMs:60,rawPath:'/private/image.png',dataUrl:'secret',caseName:'private',error:'business text'}).success,true);
 assert.deepEqual(events[0],{event:'report.view.performance',source:'renderer',taskId:'task-1',stage:'sample',maxLongTaskMs:60,thumbnailReads:3,thumbnailFailures:1});
 for(const input of [{taskId:'bad / name',stage:'sample'},{taskId:'task',stage:'arbitrary'},{taskId:'task',stage:'sample',thumbnailReads:NaN},{taskId:'task',stage:'sample',renderMs:-1}])assert.equal(record({sender},input).success,false);
 assert.equal(events.length,1);
});
test('host limits logging bursts per renderer without affecting another renderer',()=>{
 let time=0;const events=[],sender={};const record=createReportPerformanceRecorder({record:e=>events.push(e),now:()=>time});
 for(let i=0;i<12;i++)assert.equal(record({sender},{taskId:'task',stage:'sample'}).success,true);
 assert.equal(record({sender},{taskId:'task',stage:'sample'}).errorCode,'REPORT_DIAGNOSTIC_RATE_LIMIT');
 assert.equal(record({sender:{}},{taskId:'task',stage:'open'}).success,true);
 time=60000;assert.equal(record({sender},{taskId:'task',stage:'close'}).success,true);
 assert.equal(events.length,14);
});
test('thumbnail metrics identify cache hits, coalescing, read failures and cancellation without exposing paths',async()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/report-thumbnail-store.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,performance});
 const store=exports.createReportThumbnailStore(1,1), flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
 let release;store.subscribe('/secret/a',()=>new Promise(r=>release=r),()=>{});store.subscribe('/secret/a',async()=>({}),()=>{});
 const cancel=store.subscribe('/secret/b',async()=>({}),()=>{});cancel();await flush();release({success:true,dataUrl:'private'});await flush();
 store.subscribe('/secret/a',async()=>({}),()=>{});store.subscribe('/secret/fail',async()=>{throw Error('/secret/fail');},()=>{});await flush();
 const m=store.metrics();assert.equal(m.thumbnailReads,2);assert.equal(m.thumbnailCacheHits,1);assert.equal(m.thumbnailSharedReads,1);assert.equal(m.thumbnailFailures,1);assert.equal(m.thumbnailCancelled,1);assert.equal(m.thumbnailPeakActive,1);assert.equal(m.thumbnailCacheEntries,1);
 store.imageFailed('/secret/a');assert.equal(store.metrics().thumbnailDecodeFailures,1);assert.equal(store.metrics().thumbnailCacheEntries,0);
 assert.doesNotMatch(JSON.stringify(m),/secret|private/);
});

test('report observation hook starts only on report, batches metrics, and disconnects timers/observers on navigation',()=>{
 const slots=[],effects=[],timers=new Map(),frames=new Map(),calls=[];let cursor=0,clock=0,observer,disconnects=0;
 const hooks={
  useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},
  useCallback(fn){cursor++;return fn;},
  useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){old?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}},
 };
 const module={};const store={metrics:()=>({thumbnailReads:2,thumbnailFailures:1})};
 const context={exports:module,
  require:name=>name==='react'?hooks:{createReportPerformanceSession:out.createReportPerformanceSession},
  performance:{now:()=>clock,memory:{usedJSHeapSize:100}},document:{visibilityState:'visible',querySelectorAll:()=>({length:3})},
  requestAnimationFrame:fn=>{frames.set(1,fn);return 1;},cancelAnimationFrame:id=>frames.delete(id),
  window:{setInterval:(fn,ms)=>{assert.equal(ms,10000);timers.set(1,fn);return 1;},clearInterval:id=>timers.delete(id)},
  PerformanceObserver:class {static supportedEntryTypes=['longtask'];constructor(fn){observer=fn;}observe(){}takeRecords(){return [];}disconnect(){disconnects++;}},
 };
 // Use the fixture clock for the session's performance.now too.
 const fixtureOut={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/report-performance.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:fixtureOut,performance:context.performance});
 context.require=name=>name==='react'?hooks:fixtureOut;
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/hooks/use-report-performance.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
 const invoke=async(channel,payload)=>{calls.push({channel,payload});};
 const render=(taskId,count=100)=>{cursor=0;const onRender=module.useReportPerformance(taskId,count,store,invoke);while(effects.length)effects.shift()();return onRender;};
 render('');assert.equal(calls.length,0);assert.equal(timers.size,0);
 const commit=render('task-1');assert.equal(calls[0].payload.stage,'open');frames.get(1)();frames.delete(1);
 commit('report','update',70);observer({getEntries:()=>[{duration:90}]});clock=10000;timers.get(1)();
 const sample=calls.at(-1).payload;assert.equal(sample.longTaskCount,1);assert.equal(sample.maxRenderMs,70);assert.equal(sample.visibleCaseCount,3);assert.equal(sample.thumbnailFailures,1);assert.equal(sample.longTaskObserverSupported,1);
 const before=calls.length;timers.get(1)();assert.equal(calls.length,before);
 render('task-1',99);assert.equal(calls.length,before); // count changes do not reopen observers
 render('');assert.equal(calls.at(-1).payload.stage,'close');assert.equal(calls.at(-1).payload.caseCount,99);assert.equal(disconnects,1);assert.equal(timers.size,0);assert.equal(frames.size,0);
});

test('report metrics survive real persisted support-bundle export',async t=>{
 const os=await import('node:os'),path=await import('node:path'),zlib=await import('node:zlib');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-report-observe-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const d=require('../electron/diagnostics');d.configure(root);
 const record=createReportPerformanceRecorder();
 assert.equal(record({sender:{}},{taskId:'report-1',stage:'sample',thumbnailReads:3,thumbnailCacheHits:8,thumbnailMaxReadMs:1500,maxLongTaskMs:65,rawPath:'/private/report'}).success,true);
 const target=path.join(root,'report.gz');d.bundle(root,target);
 const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(target)));
 assert.equal(data.records[0].thumbnailMaxReadMs,1500);assert.equal(data.records[0].thumbnailCacheHits,8);assert.equal(data.records[0].maxLongTaskMs,65);
 assert.doesNotMatch(JSON.stringify(data),/private\/report/);
});
