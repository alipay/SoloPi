import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createSoloPiProvider}=require('../electron/solopi-provider');
function fixture({failures=0,unavailable=false,foreign=false,stopped=false}={}){
 const calls=[],queries=[];
 const entry={id:'owned-entry',serial:'fixture-phone',sessionId:'owned-phone',providerName:'desktop-owned-entry',targetPackage:'org.example.app'};
 let state=stopped?'stopped':'recording';
 const status=()=>({success:true,kind:'recording',state,active:state==='recording',recording:state==='recording',sessionId:foreign?'foreign':'owned-phone',caseName:entry.providerName,targetPackage:entry.targetPackage});
 const provider=createSoloPiProvider({resourcesDirectory:()=>'/unused',pause:async()=>{},runAdb:async args=>{
  calls.push(args);
  if(args[2]==='forward')return args[3]==='tcp:0'?'45678':'';
  if(args[3]?.includes('recordMode=stop'))state='stopped';
  return 'Starting: Intent';
 },httpRequest:async(_port,action,params)=>{
  queries.push([action,params]);
  if(params.type==='capabilities')throw Error('capabilities unavailable');
  if(unavailable||failures-->0)throw Error('connection reset');
  if(action==='record')return status();
  return {success:true,case:{caseName:entry.providerName,targetAppPackage:entry.targetPackage,operationLog:{steps:[{operationMethod:{actionEnum:'BACK',operationParam:{}}}]}}};
 }});
 return{provider,entry,calls,queries};
}
test('stop and export ignore capabilities failures and never invoke monkey or foreground SoloPi',async()=>{
 const f=fixture();const r=await f.provider.execute(f.entry,'record-stop',['--session-id','owned-phone']);assert.equal(r.state,'stopped');
 const result=await f.provider.execute(f.entry,'case-get');assert.equal(result.case.operationLog.steps.length,1);
 assert.equal(f.queries.some(([,params])=>params.type==='capabilities'),false);
 assert.equal(f.calls.some(args=>args[3]?.includes('monkey')||args[3]?.includes('LAUNCHER')),false);
 const stop=f.calls.find(args=>args[3]?.includes('recordMode=stop'));assert.ok(stop);assert.equal(stop[3].includes("'-W'"),false);
});
test('brief phone-service disconnect retries read only, then stops exactly the owned recording once',async()=>{
 const f=fixture({failures:2});assert.equal((await f.provider.execute(f.entry,'record-stop',['--session-id','owned-phone'])).state,'stopped');
 assert.equal(f.calls.filter(args=>args[3]?.includes('recordMode=stop')).length,1);
 assert.equal(f.queries.filter(([action])=>action==='record').length,4);
});
test('persistent unavailability reports service error, cleans forwarding and never launches/stops anything',async()=>{
 const f=fixture({unavailable:true});await assert.rejects(f.provider.execute(f.entry,'record-stop',['--session-id','owned-phone']),{code:'SOLOPI_SERVICE_UNAVAILABLE'});
 assert.equal(f.queries.length,3);assert.equal(f.calls.some(args=>args[2]==='shell'),false);
 assert.equal(f.calls.at(-1)[3],'--remove');
});
test('foreign sessions stay untouched and an already stopped owned session can still export',async()=>{
 const other=fixture({foreign:true});await assert.rejects(other.provider.execute(other.entry,'record-stop',['--session-id','owned-phone']),/归属/);
 assert.equal(other.calls.some(args=>args[2]==='shell'),false);
 const f=fixture({stopped:true});await f.provider.execute(f.entry,'record-stop',['--session-id','owned-phone']);await f.provider.execute(f.entry,'case-get');
 assert.equal(f.calls.some(args=>args[2]==='shell'),false);
});
test('USB reconnect rebuilds a lost forward rather than retrying the dead local port',async()=>{
 let allocations=0;const calls=[],ports=[];
 const p=createSoloPiProvider({pause:async()=>{},runAdb:async args=>{calls.push(args);return args[2]==='forward'&&args[3]==='tcp:0'?String(45678+allocations++):'';},httpRequest:async(port)=>{ports.push(port);if(port===45678)throw Object.assign(Error('port lost'),{code:'ECONNREFUSED'});return{success:true,kind:'recording',state:'recording',recording:true,active:true,sessionId:'owned',caseName:'desktop-owned',targetPackage:'org.example'};}});
 const r=await p.execute({id:'owned',serial:'phone'},'record-status');assert.equal(r.state,'recording');assert.deepEqual(ports,[45678,45679]);
 assert.ok(calls.some(args=>args[3]==='--remove'&&args[4]==='tcp:45678'));assert.equal(calls.at(-1)[4],'tcp:45679');
 assert.equal(calls.some(args=>args[2]==='shell'),false);
});

test('release stops only the selected companion after owned recording and replay are inactive',async()=>{
 for(const mode of ['owned','foreign','recording','replay','unknown']){
  const commands=[];const entry={id:'local',serial:'phone',sessionId:'ours',providerName:'desktop-ours',targetPackage:'org.example'};
  const provider=createSoloPiProvider({runAdb:async args=>{commands.push(args);return args[2]==='forward'&&args[3]==='tcp:0'?'45678':'';},httpRequest:async(_port,action)=>action==='record'?{success:true,kind:'recording',state:mode==='recording'?'recording':'stopped',recording:mode==='recording',active:mode==='recording',sessionId:mode==='foreign'?'other':'ours',caseName:entry.providerName,targetPackage:entry.targetPackage}:{success:true,...(mode==='unknown'?{}:{active:mode==='replay'})}});
  if(['recording','unknown'].includes(mode))await assert.rejects(provider.execute(entry,'record-release'));
  else assert.equal((await provider.execute(entry,'record-release')).released,mode==='owned');
  const kills=commands.filter(a=>a[2]==='shell');assert.equal(kills.length,mode==='owned'?1:0);
  if(kills.length)assert.deepEqual(kills[0],['-s','phone','shell',"'am' 'force-stop' 'com.alipay.hulu'"]);
 }
});
