const test=require('node:test'),assert=require('node:assert/strict');
const {finalizeTaskReport}=require('./workflow-report-finalization');
for(const status of ['success','failed','stopped'])test('readable '+status+' report is persisted and delivered before synchronous archive processing starts',async()=>{
 const order=[];let release;const gate=new Promise(r=>release=r);
 const result=finalizeTaskReport({id:'original',status,finishedAt:'2026-11-15T00:00:00Z'},{persist:t=>order.push('persist:'+t.reportPackageStatus),flush:async()=>order.push('flush'),onReady:async task=>{assert.equal(task.status,status);order.push('published');await gate;},exportPackage:async task=>{assert.deepEqual(order,['persist:exporting','flush','published']);order.push('archive');return {...task,reportPackage:{success:true,path:'original.glassreport'}};}});
 await new Promise(r=>setImmediate(r));assert.deepEqual(order,['persist:exporting','flush','published'],'Archive cannot block the result transport');release();await result;assert.deepEqual(order,['persist:exporting','flush','published','archive','persist:ready','flush']);
});
for(const status of ['success','failed','stopped'])test('existing outcome is delivered before recording/log/performance finalization: '+status,async()=>{
 const order=[];let release;const pending=new Promise(r=>release=r);
 const work=finalizeTaskReport({id:'t',status,finishedAt:'2026-11-15T00:00:00Z'},{persist:t=>order.push('persist:'+t.status),flush:async()=>{},onReady:async t=>{assert.equal(t.status,status);order.push('user-result');},finalizeArtifacts:async t=>{order.push('collectors');await pending;return {...t,taskLogs:['final-log']};},exportPackage:async t=>{assert.deepEqual(t.taskLogs,['final-log']);order.push('archive');return {...t,reportPackage:{success:true}};}});
 await new Promise(r=>setImmediate(r));assert.deepEqual(order,['persist:'+status,'user-result','collectors']);release();await work;assert.ok(order.indexOf('user-result')<order.indexOf('archive'));
});
