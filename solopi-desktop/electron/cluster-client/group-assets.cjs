'use strict';
// Private asset preparation only. Never grants authority or submits an executor task.
const {createHash}=require('node:crypto');
const fail=c=>Object.assign(new Error(c),{code:c});
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
class GroupAssets {
 constructor({store,observe,confirm}){Object.assign(this,{store,observe,confirm});this.queue=Promise.resolve();
 store.db.exec(`CREATE TABLE IF NOT EXISTS local_role(device_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS local_asset_request(request_id TEXT PRIMARY KEY,sha TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT) STRICT;
 CREATE TABLE IF NOT EXISTS local_asset_audit(id INTEGER PRIMARY KEY,request_id TEXT NOT NULL,action TEXT NOT NULL,source TEXT NOT NULL,at_ms INTEGER NOT NULL) STRICT;`);}
 serial(fn){const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p;}
 async invoke(req){return this.serial(async()=>{
 if(!req||typeof req!=='object'||Array.isArray(req)||!['list','confirm-role','save-group'].includes(req.action))throw fail('GROUP_INVALID');
 const fields={list:['action'],'confirm-role':['action','requestId','deviceId','role','expectedRevision'],'save-group':['action','requestId','groupId','expectedRevision','name','deviceIds']};
 if(Object.keys(req).some(k=>!fields[req.action].includes(k))||Buffer.byteLength(JSON.stringify(req))>16384)throw fail('GROUP_INVALID');
 const o=await this.observe();if(!o?.scope||!o.principal||!Array.isArray(o.devices))throw fail('GROUP_AUTHORIZATION_REQUIRED');
 const stamp=sha({scope:o.scope,principal:o.principal,devices:o.devices});
 const rows=this.store.db.prepare('SELECT body FROM local_role').all().map(r=>JSON.parse(r.body));
 const valid=(r)=>r.invalidated!==true&&r.scopeSha===sha(o.scope)&&o.devices.some(d=>d.deviceId===r.deviceId&&d.sourceIdentity===r.sourceIdentity&&d.connection===r.connection);
 this.store.tx(()=>{for(const row of rows){if(!valid(row)&&!row.invalidated){row.invalidated=true;this.store.db.prepare('UPDATE local_role SET body=? WHERE device_id=?').run(JSON.stringify(row),row.deviceId);}}});
 if(req.action==='list')return {devices:o.devices.map(d=>({...d,revision:rows.find(r=>r.deviceId===d.deviceId)?.revision||0,confirmation:rows.find(r=>r.deviceId===d.deviceId&&valid(r))||null})),groups:this.store.list(),scope:o.scope};
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!uuid.test(req.requestId))throw fail('GROUP_INVALID');
 const hash=sha({req,scope:o.scope,principal:o.principal,stamp}),old=this.store.db.prepare('SELECT * FROM local_asset_request WHERE request_id=?').get(req.requestId);
 if(old){if(old.sha!==hash)throw fail('GROUP_EXECUTION_CONFLICT');if(old.state!=='done')throw fail('GROUP_RECONCILIATION_REQUIRED');return JSON.parse(old.receipt);}
 const fresh=async()=>{const x=await this.observe();if(sha({scope:x.scope,principal:x.principal,devices:x.devices})!==stamp)throw fail('GROUP_RECONCILIATION_REQUIRED');};
 let result;
 if(req.action==='confirm-role'){
 const d=o.devices.find(d=>d.deviceId===req.deviceId);if(!d||!['phone','glasses'].includes(req.role)||!Number.isSafeInteger(req.expectedRevision)||req.expectedRevision<0)throw fail('GROUP_INVALID');
 const prior=rows.find(r=>r.deviceId===d.deviceId);if((prior?.revision||0)!==req.expectedRevision)throw fail('GROUP_REVISION_CONFLICT');
 if(await this.confirm({device:d,role:req.role,scope:o.scope})!==true)throw fail('GROUP_LOCAL_CONFIRMATION_REQUIRED');await fresh();
 result={...d,role:req.role,revision:req.expectedRevision+1,scopeSha:sha(o.scope),source:'trusted-local-native-dialog',principal:o.principal,confirmedAt:new Date().toISOString()};
 this.store.tx(()=>{this.store.db.prepare('INSERT INTO local_role VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(d.deviceId,result.revision,JSON.stringify(result));this.record(req,hash,result,o);});return result;
 }
 if(req.action==='save-group'){
 if(!Array.isArray(req.deviceIds)||req.deviceIds.length>128||!req.deviceIds.length||new Set(req.deviceIds).size!==req.deviceIds.length)throw fail('GROUP_INVALID');
 const members=req.deviceIds.map(id=>{const role=rows.find(r=>r.deviceId===id&&valid(r));if(!role)throw fail('GROUP_LOCAL_CONFIRMATION_REQUIRED');return {deviceId:id,sourceIdentity:role.sourceIdentity,role:role.role};});
 await fresh();result=this.store.save({groupId:req.groupId,expectedRevision:req.expectedRevision,name:req.name,members},r=>this.record(req,hash,r,o));return result;
 }
 throw fail('GROUP_INVALID');
 });}
 record(req,hash,result,o){this.store.db.prepare("INSERT INTO local_asset_request VALUES(?,?,'done',?)").run(req.requestId,hash,JSON.stringify(result));this.store.db.prepare('INSERT INTO local_asset_audit(request_id,action,source,at_ms) VALUES(?,?,?,?)').run(req.requestId,req.action,o.principal,Date.now());}
}
module.exports={GroupAssets};
