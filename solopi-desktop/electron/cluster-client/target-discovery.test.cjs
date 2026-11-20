const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {androidDiscovery,DeviceSnapshot}=require('./device-snapshot.cjs');
test('known target skips global enumeration while unknown inventory still enumerates',async()=>{
 const calls=[],runAdb=async args=>{calls.push(args);if(args[0]==='devices')throw Object.assign(Error('unrelated router stalled'),{code:'COMMAND_EXECUTION_TIMEOUT'});return 'physical-id\n';};
 const discover=androidDiscovery({runAdb,parseAdbDevices:()=>[]});
 assert.deepEqual(await discover(undefined,{serials:['target']}),[{serial:'target',stableId:'physical-id',name:undefined,kind:'other'}]);
 assert.deepEqual(calls,[['-s','target','shell','getprop','ro.serialno']]);await assert.rejects(discover(),/router stalled/);
});
test('targeted discovery verifies physical identity and fails a remapped or offline target',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'target-snapshot-'));try{
 const snap=new DeviceSnapshot(dir),fp='sha256:'+createHash('sha256').update('android:ro.serialno\0stable').digest('hex'),id='01M6Y44C6NZH1XC3731XHW55X2';snap.data.mappings[fp]={deviceId:id,serial:'target'};
 let seen;const discover=async(signal,options)=>{seen=options;return[{serial:'target',stableId:'stable'}];};
 assert.deepEqual(await snap.resolveDevice(id,discover),{serial:'target'});assert.deepEqual(seen,{serials:['target']});
 await assert.rejects(snap.resolveDevice(id,async()=>[{serial:'target',stableId:'different'}]),e=>e.code==='DEVICE_NOT_AVAILABLE');
 await assert.rejects(snap.resolveDevice(id,async()=>{throw Error('offline');}),/offline/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
