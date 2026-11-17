'use strict';
const { spawn } = require('node:child_process');
const fs=require('node:fs');
const { openScrcpyStream } = require('../scrcpy-stream');
const { createPacketParser, avcCodec } = require('../scrcpy-packets');
const { ULID } = require('./identity.cjs');
const { ConnectorError } = require('./transport.cjs');
const error = code => new ConnectorError(code);
const category = e => /^[A-Z][A-Z0-9_]{1,63}$/.test(e?.code||'')?e.code:'MEDIA_FAILED';
const MAX_MESSAGE = 1024 * 1024, MAX_BUFFER = 2 * 1024 * 1024;
const WINDOW_BYTES = 4 * 1024 * 1024;

// Thin transport adapter. Runtime and the existing Broker lease must be injected
// by the owner; this module never chooses a device or bypasses an occupied lease.
function createScrcpyCapture({ runtime, acquireDevice, openStream = openScrcpyStream, spawnProcess = spawn, subscribeVideo }) {
  if(typeof runtime!=='function'||typeof acquireDevice!=='function')throw error('MEDIA_RUNTIME_REQUIRED');
  return async ({ target, mediaSessionId, signal, onAccessUnit, onError, onMetrics }) => {
    signal.throwIfAborted();
    const shared=subscribeVideo?.(target.serial,{signal,onAccessUnit,onError});
    if(shared)return shared;
    const lease=await acquireDevice({id:mediaSessionId,name:'实验室屏幕查看',reservedDeviceSerials:[target.serial]});
    let stream,closing;const children=[];let config=null,waitingKey=true;const parameterSets=new Map();
    const close=()=>closing||=(async()=>{
      try { await stream?.close(); }
      finally { await Promise.all(children.map(child=>new Promise(resolve=>{
        if(child.exitCode!==null||child.signalCode)return resolve();
        const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1500);
        child.once('close',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
      })));lease.release(); }
    })();
    try {
      signal.throwIfAborted();
      const parse=createPacketParser(packet=>{
        if(signal.aborted)return;
        if(packet.configuration){
          if(packet.data.length>65536)throw error('MEDIA_FRAME_INVALID');
          const starts=[];for(let i=0;i+3<packet.data.length;i++){
            const n=packet.data[i]===0&&packet.data[i+1]===0?(packet.data[i+2]===1?3:packet.data[i+2]===0&&packet.data[i+3]===1?4:0):0;
            if(n){starts.push([i,n]);i+=n-1;}
          }
          starts.forEach(([at,n],i)=>{const type=packet.data[at+n]&31;if(type===7||type===8)parameterSets.set(type,Buffer.from(packet.data.subarray(at,starts[i+1]?.[0]??packet.data.length)));});
          if(parameterSets.has(7)&&parameterSets.has(8)){config=Buffer.concat([parameterSets.get(7),parameterSets.get(8)]);avcCodec(config);}
          waitingKey=true;return;
        }
        if(!config)return;
        if(packet.type==='key'){waitingKey=false;onAccessUnit(Buffer.concat([config,packet.data]),packet.timestamp);}
        else if(!waitingKey)onAccessUnit(packet.data,packet.timestamp);
      },{protocolMajor:()=>stream?.protocolMajor||3});
      stream=await openStream(runtime(),target.serial,{spawnProcess,signal,onMetrics,onChild:child=>{
        children.push(child);child.once('error',()=>onError(error('MEDIA_CAPTURE_FAILED')));
        child.once('close',()=>{if(!signal.aborted)onError(error('MEDIA_CAPTURE_CLOSED'));});
      },onError:()=>onError(error('MEDIA_CAPTURE_FAILED'))});
      signal.throwIfAborted();
      stream.socket.on('end',()=>onError(error('MEDIA_CAPTURE_CLOSED')));
      // A reset/destroy may close without end/error. Never retain its Broker lease
      // until TTL; intentional cleanup already owns closing and suppresses this.
      stream.socket.once('close',()=>{if(!closing&&!signal.aborted)onError(error('MEDIA_CAPTURE_CLOSED'));});
      stream.socket.on('data',data=>{try{parse(data);}catch{onError(error('MEDIA_FRAME_INVALID'));}});
      parse(stream.first);stream.socket.resume();
      return {close,parentTaskId:lease.task?.parentTaskId||null};
    } catch(e) {await close();throw e;}
  };
}

class ClientMedia {
  constructor({connector,resolveDevice,capture,signal,socketFactory,ca,diagnosticsPath,onState=()=>{}}) {
    this.diagnosticsPath=diagnosticsPath;this.connector=connector;this.resolveDevice=resolveDevice;this.capture=capture;this.onState=onState;
    this.controller=new AbortController();this.signal=AbortSignal.any([this.controller.signal,signal||new AbortController().signal]);
    this.socketFactory=socketFactory||((url)=>{
      if(ca)throw error('MEDIA_CA_ADAPTER_REQUIRED'); // never discard a configured CA or disable TLS
      if(typeof globalThis.WebSocket!=='function')throw error('MEDIA_SOCKET_ADAPTER_REQUIRED');
      return new globalThis.WebSocket(url);
    });
    this.previewJobs=new Map();this.entries=new Map();this.running=null;this.state={status:'idle'};this.closed=false;
    this.signal.addEventListener('abort',()=>{void this.stopActive();},{once:true});
  }
  diagnostic(event){
    require('../diagnostics').record({event:'lab.media.'+event.event,requestId:event.mediaSessionId,stage:event.stage,code:event.errorCode,durationMs:event.elapsedMs,...event.timings});
    if(!this.diagnosticsPath)return;
    try{
      if(fs.existsSync(this.diagnosticsPath)&&fs.statSync(this.diagnosticsPath).size>5*1024*1024)fs.renameSync(this.diagnosticsPath,this.diagnosticsPath+'.1');
      fs.appendFileSync(this.diagnosticsPath,JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600});
    }catch{/* Diagnostics must not interrupt capture or task execution. */}
  }
  get active(){return [...this.entries.values()].filter(e=>!e.signal.aborted).at(-1)||null;}
  update(state){this.state=state;this.onState({...state});}
  start(){if(!this.running){this.update({status:'idle'});this.running=this.loop();}return this;}
  async pause(ms){if(this.signal.aborted)return;await new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);this.signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,ms);this.signal.addEventListener('abort',finish,{once:true});
  });}
  async loop(){
    try{
      while(!this.signal.aborted){
        const page=await this.connector.events(this.signal);this.signal.throwIfAborted();
        // Missing/pruned events cannot revive a previous capture. Checkpoint only
        // observed events, never snapshot stateInstalledSeq over unseen tickets.
        for(const event of page.events){
          this.signal.throwIfAborted();
          this.connector.checkpointEvents(event.seq); // at-most-once ticket use, including crash recovery
          if(event.type==='media.authorized'&&event.epoch===this.connector.session?.epoch){
            const key=event.data?.deviceId,previous=this.previewJobs.get(key)||Promise.resolve();
            const job=previous.then(()=>{this.signal.throwIfAborted();return this.authorize(event.data);}).catch(e=>{if(!this.signal.aborted)this.update({status:'error',errorCode:category(e)});}).finally(()=>{if(this.previewJobs.get(key)===job)this.previewJobs.delete(key);});this.previewJobs.set(key,job);
          }
        }
        await this.pause(page.hasMore?100:1000);
      }
    }catch(e){if(!this.signal.aborted)this.update({status:'error',errorCode:category(e)});}
    finally{await this.stopActive();this.finished=true;}
  }
  async authorize(data){
    const ticket=data?.clientTicket;
    if(!ULID.test(data?.mediaSessionId)||!ULID.test(data?.deviceId)||data?.dataPlanePath!=='/ws/media/{ticket}'||ticket?.role!=='client'||ticket.oneTimeUse!==true||!/^[-A-Za-z0-9._]{32,256}$/.test(ticket.token)||!Number.isFinite(Date.parse(ticket.expiresAt))||Date.parse(ticket.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now())throw error('MEDIA_AUTHORIZATION_INVALID');
    // A new device must not tear down another authorized device. Same-device
    // replacement still waits for its previous lease/capture to finish.
    await Promise.all([...this.entries.values()].filter(e=>e.deviceId===data.deviceId||e.mediaSessionId===data.mediaSessionId).map(e=>this.stopActive(e)));this.signal.throwIfAborted();
    const controller=new AbortController(),signal=AbortSignal.any([this.signal,controller.signal]);
    const entry={startedAt:Date.now(),timings:{},stage:'resolve-target',controller,signal,ws:null,capture:null,opening:null,closing:null,deviceId:data.deviceId,mediaSessionId:data.mediaSessionId,bytes:0,frames:0,windowAt:Date.now(),windowBytes:0};
    this.entries.set(entry.mediaSessionId,entry);this.diagnostic({mediaSessionId:entry.mediaSessionId,event:'opening'});
    const stop=e=>{if(!signal.aborted&&e?.code){entry.errorCode=category(e);this.diagnostic({mediaSessionId:entry.mediaSessionId,event:'capture-failed',stage:entry.stage,errorCode:entry.errorCode,elapsedMs:Date.now()-entry.startedAt,timings:entry.timings});}void this.stopActive(entry);};
    try{
      const owner={clientId:this.connector.state?.clientId,epoch:this.connector.session?.epoch};
      const checkOwner=()=>{signal.throwIfAborted();if(this.connector.state?.clientId!==owner.clientId||this.connector.session?.epoch!==owner.epoch)throw error('MEDIA_SESSION_CHANGED');};
      const target=await this.resolveDevice(data.deviceId,signal);checkOwner();entry.timings.targetMs=Date.now()-entry.startedAt;entry.stage='connect-relay';
      const origin=new URL(this.connector.config.serverUrl);
      if(origin.protocol!=='https:')throw error('MEDIA_HTTPS_REQUIRED');
      origin.protocol='wss:';origin.pathname='/ws/media/'+ticket.token;
      const ws=this.socketFactory(origin.href);entry.ws=ws;
      ws.addEventListener('close',e=>stop(e.code===1000?undefined:error('MEDIA_CONNECTION_FAILED')),{once:true});
      ws.addEventListener('error',()=>stop(error('MEDIA_CONNECTION_FAILED')),{once:true});
      await new Promise((resolve,reject)=>{
        const done=e=>{clearTimeout(timer);signal.removeEventListener('abort',abort);ws.removeEventListener('open',opened);ws.removeEventListener('error',failed);ws.removeEventListener('close',failed);e?reject(e):resolve();};
        const opened=()=>done(),failed=()=>done(error('MEDIA_CONNECTION_FAILED')),abort=()=>done(error('ABORTED'));
        const timer=setTimeout(()=>done(error('MEDIA_CONNECT_TIMEOUT')),10000);
        ws.addEventListener('open',opened,{once:true});ws.addEventListener('error',failed,{once:true});ws.addEventListener('close',failed,{once:true});signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted)abort();
      });
      checkOwner();entry.timings.relayMs=Date.now()-entry.startedAt;entry.stage='capture';
      this.update({status:'capturing',mediaSessionId:data.mediaSessionId,sentFrames:0,sentBytes:0});
      entry.opening=Promise.resolve(this.capture({target,mediaSessionId:data.mediaSessionId,signal,onError:stop,onMetrics:metrics=>{(entry.timings.capture??=[]).push(metrics);},onAccessUnit:(au)=>{
        if(signal.aborted||this.entries.get(entry.mediaSessionId)!==entry)return;
        try{checkOwner();}catch{stop();return;}
        if(!Buffer.isBuffer(au)||au.length>MAX_MESSAGE||ws.readyState!==1||ws.bufferedAmount+au.length>MAX_BUFFER){stop();return;}
        const at=Date.now();if(at-entry.windowAt>=1000){entry.windowAt=at;entry.windowBytes=0;}
        entry.windowBytes+=au.length;if(entry.windowBytes>WINDOW_BYTES){stop();return;}
        try{if(!entry.frames){entry.timings.firstFrameMs=Date.now()-entry.startedAt;this.diagnostic({mediaSessionId:entry.mediaSessionId,event:'first-frame',timings:entry.timings});}ws.send(au);entry.bytes+=au.length;entry.frames++;this.update({status:'capturing',mediaSessionId:data.mediaSessionId,sentFrames:entry.frames,sentBytes:entry.bytes});}catch{stop();}
      }}));
      entry.capture=await entry.opening;
      entry.parentTaskId=entry.capture?.parentTaskId||null;
      if(signal.aborted)return; // stopActive owns late-open cleanup exactly once
      const ttl=Math.max(1,Date.parse(data.expiresAt)-Date.now());entry.expiry=setTimeout(stop,Math.min(ttl,2147483647));
    }catch(e){this.diagnostic({mediaSessionId:entry.mediaSessionId,event:'open-failed',stage:entry.stage,errorCode:category(e),elapsedMs:Date.now()-entry.startedAt,timings:entry.timings});await this.stopActive(entry);throw e;}
  }
  stopActive(entry){
    if(!entry)return Promise.all([...this.entries.values()].map(e=>this.stopActive(e)));
    if(entry.closing)return entry.closing;
    entry.controller.abort();clearTimeout(entry.expiry);
    try{entry.ws?.close(1000,'client-stopped');}catch{/* closing socket */}
    entry.closing=(async()=>{
      try{const capture=entry.capture||await entry.opening;await capture?.close();}
      catch{/* failed setup still owns its cleanup */}
      if(this.entries.get(entry.mediaSessionId)===entry)this.entries.delete(entry.mediaSessionId);
      this.diagnostic({mediaSessionId:entry.mediaSessionId,event:'closed',sentFrames:entry.frames,sentBytes:entry.bytes,timings:entry.timings});
      if(!this.active)this.update({status:entry.errorCode?'error':'stopped',...(entry.errorCode?{errorCode:entry.errorCode}:{}),sentFrames:entry.frames,sentBytes:entry.bytes});
    })();return entry.closing;
  }
  async close(){if(this.closed)return this.closing;this.closed=true;this.controller.abort();this.closing=(async()=>{await this.stopActive();await this.running;})();return this.closing;}
}
module.exports={ClientMedia,createScrcpyCapture};
