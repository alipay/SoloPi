'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ConnectorError } = require('./transport.cjs');
const { ULID } = require('./identity.cjs');
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function id() {
  let n = BigInt(Date.now()); let out = '';
  for (let i=0;i<10;i++) { out=alphabet[Number(n&31n)]+out;n>>=5n; }
  return out+[...crypto.randomBytes(16)].map(n=>alphabet[n&31]).join('');
}
function check(file, directory=false) {
  const s=fs.lstatSync(file);
  if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile())||(s.mode&0o077)||s.uid!==process.getuid?.())throw new ConnectorError('STATE_PERMISSIONS');
}
// Owned by the Desktop connection's serial queue and identity lock. No tokens or
// raw stable identifiers are stored; mappings retain only the last ADB transport.
class DeviceSnapshot {
  constructor(directory) {
    fs.mkdirSync(directory,{recursive:true,mode:0o700});check(directory,true);
    this.directory=directory;this.file=path.join(directory,'devices.json');
    this.data={version:1,mappings:{},owner:null,pending:null};
    if(fs.existsSync(this.file)){check(this.file);this.data=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(this.data.version!==1||!this.data.mappings||typeof this.data.mappings!=='object'||Array.isArray(this.data.mappings))throw new ConnectorError('DEVICE_STATE_INVALID');
      for(const [fp,m]of Object.entries(this.data.mappings))if(!/^sha256:[0-9a-f]{64}$/.test(fp)||!ULID.test(m?.deviceId)||!Number.isFinite(Date.parse(m.connectedAt)))throw new ConnectorError('DEVICE_STATE_INVALID');
    }
    this.busy=null;
  }
  save(){const tmp=this.file+'.'+crypto.randomUUID()+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(this.data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,this.file);const d=fs.openSync(this.directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
  resolvePreviewDevice(deviceId,signal){
    signal?.throwIfAborted();
    if(!ULID.test(deviceId))throw new ConnectorError('DEVICE_IDENTITY_INVALID');
    const rows=Object.values(this.data.mappings).filter(m=>m.deviceId===deviceId);
    if(rows.length!==1||!rows[0].serial)throw new ConnectorError('DEVICE_NOT_AVAILABLE');
    // Preview uses the last discovered transport directly. Capture reports an
    // unavailable target; it must never enumerate unrelated devices first.
    return {serial:rows[0].serial};
  }
  async resolveDevice(deviceId,discover,signal){
    if(!ULID.test(deviceId))throw new ConnectorError('DEVICE_IDENTITY_INVALID');
    const mappings=Object.entries(this.data.mappings).filter(([,m])=>m.deviceId===deviceId);
    if(mappings.length!==1)throw new ConnectorError('DEVICE_NOT_OWNED');
    const serial=mappings[0][1].serial;
    if(!serial)throw new ConnectorError('DEVICE_NOT_AVAILABLE');
    const rows=await discover(signal,{serials:[serial]});signal?.throwIfAborted();
    if(!Array.isArray(rows)||rows.length>500)throw new ConnectorError('DEVICE_DISCOVERY_FAILED');
    const matches=rows.filter(d=>typeof d.stableId==='string'&&'sha256:'+crypto.createHash('sha256').update('android:ro.serialno\0'+d.stableId.trim()).digest('hex')===mappings[0][0]);
    if(matches.length!==1||typeof matches[0].serial!=='string'||!matches[0].serial)throw new ConnectorError('DEVICE_NOT_AVAILABLE');
    return {serial:matches[0].serial};
  }
  async publish(connector,watermark,discover,signal){
    if(this.busy)return this.busy;
    this.busy=this.run(connector,watermark,discover,signal).finally(()=>{this.busy=null;});return this.busy;
  }
  async run(connector,watermark,discover,signal){
    const session=connector.session, clientId=connector.state.clientId;
    if(!session||!ULID.test(clientId))throw new ConnectorError('SESSION_REQUIRED');
    if(!watermark||!Number.isSafeInteger(watermark.epoch)||watermark.epoch<1||!Number.isSafeInteger(watermark.seq)||watermark.seq<0||watermark.epoch>session.epoch)throw new ConnectorError('DEVICE_WATERMARK_REQUIRED');
    const current={clientId,epoch:session.epoch};
    if(JSON.stringify(this.data.owner)!==JSON.stringify(current)){this.data.owner=current;this.data.pending=null;this.save();}
    const seq=watermark.epoch===session.epoch?watermark.seq:0;
    if(this.data.pending&&this.data.pending.seq<=seq){this.data.pending=null;this.save();}
    if(this.data.pending&&this.data.pending.seq!==seq+1)throw new ConnectorError('DEVICE_WATERMARK_CONFLICT');
    if(!this.data.pending){
      let devices=[],discoveryStatus='ok';
      try{
        const observed=await discover(signal);signal?.throwIfAborted();
        if(!Array.isArray(observed)||observed.length>500)throw new ConnectorError('DEVICE_DISCOVERY_FAILED');
        const seen=new Set();
        for(const d of observed){
          if(typeof d.stableId!=='string'||!d.stableId.trim()||['unknown','null','undefined'].includes(d.stableId.trim().toLowerCase()))throw new ConnectorError('DEVICE_STABLE_ID_UNAVAILABLE');
          const fp='sha256:'+crypto.createHash('sha256').update('android:ro.serialno\0'+d.stableId.trim()).digest('hex');
          if(seen.has(fp))throw new ConnectorError('DEVICE_DISCOVERY_DUPLICATE');seen.add(fp);
          const m=this.data.mappings[fp]??={deviceId:id(),connectedAt:new Date().toISOString()};
          m.serial=String(d.serial||'');
          devices.push({deviceId:m.deviceId,discoveryFingerprint:fp,kind:['phone','glasses','tablet'].includes(d.kind)?d.kind:'other',os:'android',connectedAt:m.connectedAt,...(d.name?{deviceName:String(d.name).slice(0,128)}:{}),...(d.serial?{adbSerial:String(d.serial).slice(0,128)}:{})});
        }
        devices.sort((a,b)=>a.deviceId.localeCompare(b.deviceId));
      }catch(e){if(signal?.aborted)throw e;discoveryStatus='failed';devices=[];}
      this.data.pending={epoch:session.epoch,seq:seq+1,snapshotId:id(),takenAt:new Date().toISOString(),discoveryStatus,devices};this.save();
    }
    signal?.throwIfAborted();
    const pending=this.data.pending;
    const result=await connector.call('POST','/v1/devices/snapshot',{sessionId:session.sessionId,...pending},session.sessionId,signal);
    if(result?.snapshotId!==pending.snapshotId||!Number.isSafeInteger(result.revision)||result.revision<1||typeof result.installed!=='boolean')throw new ConnectorError('CONTRACT_MISMATCH');
    this.data.pending=null;this.save();
    return {revision:result.revision,installed:result.installed,discoveryStatus:pending.discoveryStatus};
  }
}
// Thin adapter over the application's configured ADB and parser. No pairing,
// capture, control, ADB server lifecycle, or inferred phone/glasses association.
function androidDiscovery({runAdb,parseAdbDevices}){
  return async (signal,{serials}={})=>{
    // A known target needs only a live identity probe, not a global router scan.
    if(serials && (!Array.isArray(serials)||!serials.length||serials.some(s=>typeof s!=='string'||!s)))throw new ConnectorError('DEVICE_IDENTITY_INVALID');
    const rows=serials?[...new Set(serials)].map(serial=>({serial,state:'device'})):parseAdbDevices(await runAdb(['devices','-l'],5000,signal));const out=[];
    if(rows.length>500)throw new ConnectorError('DEVICE_DISCOVERY_FAILED');
    for(const d of rows){
      signal?.throwIfAborted();if(d.state!=='device')continue;
      const stableId=(await runAdb(['-s',d.serial,'shell','getprop','ro.serialno'],5000,signal)).trim();
      out.push({stableId,serial:d.serial,name:d.model||undefined,kind:'other'});
    }
    return out;
  };
}
module.exports={DeviceSnapshot,androidDiscovery};
