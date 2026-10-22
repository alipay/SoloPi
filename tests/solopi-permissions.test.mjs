import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {ensureSoloPiPermissions,SERVICE}=require('../electron/solopi-permissions');
function fixture({permissions={},root='none',grantsWork=true,denyGrant=false,user='10',previous='org.other/.Service',connectWorks=true,invalid=false,mode='record',host=true}={}) {
 const state={adb:true,float:true,background:true,accessibility:true,powerSave:true,...permissions};
 const calls=[],controller=new AbortController();let clock=0;
 const options={mode,signal:controller.signal,now:()=>clock,pause:async ms=>{clock+=ms;},
  read:async()=>{calls.push(['health']);return{success:!invalid,permissions:{...state},...(host?{executionProfiles:{host:{replayMode:'headless'}}}:{})};},
  connectAdb:async()=>{calls.push(['connect']);state.adb=connectWorks;},
  shell:async words=>{
   calls.push(words);
   if(words[0]==='id')return root==='adbd'?'0':'2000';
   if(words[0]==='su'&&words[2]==='id -u')return root==='su'?'0':'2000';
   if(words[0]==='am')return user;
   const text=words.join(' ');
   if(text.includes('get')&&text.includes('enabled_accessibility_services'))return previous;
   if(denyGrant)throw Error('permission denied');
   if(grantsWork){
    if(text.includes('SYSTEM_ALERT_WINDOW'))state.float=true;
    if(text.includes('deviceidle'))state.powerSave=true;
    if(text.includes('accessibility_enabled'))state.accessibility=true;
   }
   return '';
  }};
 return{calls,state,controller,run:()=>ensureSoloPiPermissions(options)};
}
test('ready permissions cost one health read and no root probing or grants',async()=>{
 const f=fixture();assert.deepEqual(await f.run(),{root:false,missing:[],attempts:[]});assert.deepEqual(f.calls,[['health']]);
});
test('non-root device reports exact missing permissions and never changes system settings',async()=>{
 const f=fixture({permissions:{float:false,powerSave:false}});
 await assert.rejects(f.run(),e=>e.code==='SOLOPI_PERMISSIONS_REQUIRED'&&e.permissionCheck.root===false&&e.permissionCheck.missing.length===2);
 assert.equal(f.calls.some(a=>a[0]==='settings'||a[0]==='cmd'||a[0]==='connect'),false);
});
for(const root of ['adbd','su'])test(`authorized ${root} grants only missing permissions, uses active user and preserves other accessibility services`,async()=>{
 const f=fixture({root,permissions:{float:false,accessibility:false,powerSave:false}});
 const result=await f.run();assert.equal(result.root,true);assert.equal(result.attempts.length,3);
 const text=f.calls.map(a=>a.join(' ')).join('\n');
 assert.ok(text.includes('org.other/.Service:'+SERVICE));assert.match(text,/10/);
 assert.doesNotMatch(text,/adb root|force-stop|tcpip|pm clear|kill-server/);
 assert.equal(f.calls.filter(a=>a[0]==='connect').length,0);
});
for(const options of [{grantsWork:false},{denyGrant:true}])test(`root commands ${options.denyGrant?'denied':'exit successfully without effect'} cannot bypass final health verification`,async()=>{
 const f=fixture({root:'adbd',permissions:{accessibility:false},...options});
 await assert.rejects(f.run(),e=>e.permissionCheck.root&&e.permissionCheck.missing.some(x=>x.key==='accessibility'));
 assert.equal(f.calls.some(a=>a[0]==='connect'),false);
});
test('existing SoloPi accessibility service is not duplicated',async()=>{
 const f=fixture({root:'adbd',permissions:{accessibility:false},previous:SERVICE});await f.run();
 const write=f.calls.find(a=>a.includes('enabled_accessibility_services')&&a.includes('put'));
 assert.equal(write.at(-1),SERVICE);
});
test('unverified or invalid Android user blocks grants rather than modifying user zero',async()=>{
 const f=fixture({root:'adbd',permissions:{float:false},user:'unknown'});
 await assert.rejects(f.run(),{code:'SOLOPI_PERMISSIONS_REQUIRED'});assert.equal(f.calls.some(a=>a[0]==='cmd'),false);
});
test('internal adb preparation runs after other permissions and requires a fresh true receipt',async()=>{
 const f=fixture({permissions:{adb:false}});await f.run();assert.deepEqual(f.calls.map(a=>a[0]),['health','connect','health']);
 await assert.rejects(fixture({permissions:{adb:false},connectWorks:false}).run(),{code:'SOLOPI_PERMISSIONS_REQUIRED'});
});
test('invalid health is blocked, and unsupported vendor permission is not invented as an automatic grant',async()=>{
 await assert.rejects(fixture({invalid:true}).run(),{code:'SOLOPI_PERMISSIONS_REQUIRED'});
 const f=fixture({root:'adbd',permissions:{background:false}});await assert.rejects(f.run(),{code:'SOLOPI_PERMISSIONS_REQUIRED'});
 assert.equal(f.calls.some(a=>a[0]==='settings'||a[0]==='cmd'),false);
});
test('headless replay requires adb and accessibility, preserving its existing permission profile',async()=>{
 const f=fixture({mode:'replay',permissions:{float:false,background:false,powerSave:false}});await f.run();assert.deepEqual(f.calls,[['health']]);
});
test('cancellation prevents root probing and setting changes',async()=>{
 const f=fixture({root:'adbd',permissions:{float:false}});f.controller.abort();await assert.rejects(f.run());assert.deepEqual(f.calls,[]);
});

test('legacy replay retains its full permission requirements',async()=>{
 const f=fixture({mode:'replay',host:false,permissions:{float:false}});
 await assert.rejects(f.run(),e=>e.permissionCheck.missing.some(p=>p.key==='float'));
});
