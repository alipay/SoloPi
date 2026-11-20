'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Connector } = require('./connector.cjs');
const { endpoint, createTransport, ConnectorError } = require('./transport.cjs');
const TERMINAL = new Set(['AUTH_REVOKED','ENROLL_REJECTED','ENROLL_RECOVERY_KEY_MISMATCH','IDENTITY_TERMINAL']);
class DesktopConnection {
  constructor({ directory, version, makeConnector = options => new Connector(options), transport = createTransport, discoverDevices, mediaFactory, agentExecutorFactory, groupServiceFactory, groupDispatchFactory, labFactory }) {
    this.labFactory=labFactory;this.lab=null;this.labClosing=Promise.resolve();this.labState={status:labFactory?'idle':'not-enabled'};
    this.groupDispatchFactory=groupDispatchFactory;this.groupDispatch=null;this.groupClosing=Promise.resolve();
    this.groupServiceFactory=groupServiceFactory;this.groupService=null;this.groupState={status:'not-enabled'};
    this.directory=directory; this.version=version; this.makeConnector=makeConnector; this.transport=transport;
    this.discoverDevices=discoverDevices;this.deviceReporter=null;this.deviceSnapshotState={status:'not-enabled'};
    this.agentExecutorFactory=agentExecutorFactory;this.agentTasks=null;this.agentClosing=Promise.resolve();this.agentTimer=null;this.agentState={status:agentExecutorFactory?"idle":"not-enabled"};
    this.mediaFactory=mediaFactory;this.media=null;this.mediaClosing=Promise.resolve();this.mediaState={status:mediaFactory?'idle':'not-enabled'};
    this.file=path.join(directory,'connection.json'); this.queue=Promise.resolve(); this.phase='disabled'; this.error=null;
    this.intentGeneration=0;this.operations=new Map();this.closed=false; this.connector=null; this.controller=null; this.timer=null; this.lastUpdatedAt=null;
    fs.mkdirSync(directory,{recursive:true,mode:0o700}); this.check(directory,true);
    this.settings={config:null,enabled:false,enrolled:false};
    if(fs.existsSync(this.file)){this.check(this.file);this.settings=JSON.parse(fs.readFileSync(this.file,'utf8')); if(typeof this.settings.enabled!=='boolean'||typeof this.settings.enrolled!=='boolean')throw new ConnectorError('CONFIG_INVALID');if(this.settings.config)this.settings.config=this.validate({...this.settings.config,apiMode:this.settings.config.apiMode ?? (this.settings.config.serverUrl.startsWith('http:')?'cp':'v1')});}
    this.settings.registered??=false;this.settings.cancelPending??=false;this.settings.identityBound??=this.settings.enrolled||fs.existsSync(path.join(directory,'identity','identity.json'));
    if(this.settings.cancelPending){this.phase='cancel_failed';this.error=this.settings.cancelError||'CANCEL_PENDING';}
    else if(this.settings.terminalReason){this.phase='revoked';this.error=this.settings.terminalReason;}
  }
  check(file,dir=false){const s=fs.lstatSync(file);if(s.isSymbolicLink()||(dir?!s.isDirectory():!s.isFile())||(s.mode&0o077)||s.uid!==process.getuid?.())throw new ConnectorError('STORAGE_PERMISSIONS');}
  validate(input){
    if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['serverUrl','orgKey','projectKey','computerName','caFile','allowInsecureHttp','apiMode'].includes(k)))throw new ConnectorError('CONFIG_INVALID');
    const serverUrl=endpoint(input.serverUrl,{allowInsecureHttp:true});
    if(input.apiMode!==undefined&&!['cp','v1'].includes(input.apiMode))throw new ConnectorError('CONFIG_INVALID');
    const config={serverUrl,apiMode:input.apiMode??'cp',allowInsecureHttp:serverUrl.startsWith('http:')};
    for(const k of ['orgKey','projectKey']){if(typeof input[k]!=='string'||!input[k].trim()||input[k].length>128)throw new ConnectorError('CONFIG_INVALID');config[k]=input[k].trim();}
    for(const k of ['computerName','caFile']){if(input[k]!==undefined&&typeof input[k]!=='string')throw new ConnectorError('CONFIG_INVALID');config[k]=(input[k]||'').trim();if(config[k].length>4096)throw new ConnectorError('CONFIG_INVALID');}
    if(config.allowInsecureHttp)config.caFile='';
    if(config.caFile&&!path.isAbsolute(config.caFile))throw new ConnectorError('CA_PATH_REQUIRED');return config;
  }
  persist(){const tmp=this.file+'.'+require('node:crypto').randomUUID()+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(this.settings));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,this.file);const d=fs.openSync(this.directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}
  snapshot(){return {success:true,config:this.settings.config,enabled:this.settings.enabled,enrolled:this.settings.enrolled,registered:this.settings.registered,cancelPending:this.settings.cancelPending,identityBound:this.settings.identityBound,phase:this.phase,errorCode:this.error,lastUpdatedAt:this.lastUpdatedAt,deviceSnapshot:this.deviceSnapshotState,groups:this.groupState,lab:this.labState,media:this.mediaState,agent:this.agentState,identity:this.connector?.status()||null};}
  ca(config){return config.caFile?fs.readFileSync(config.caFile,'utf8'):undefined;}
  stop(){clearTimeout(this.timer);this.timer=null;this.controller?.abort();}
  release(){const lab=this.lab;this.lab=null;if(lab)this.labClosing=Promise.allSettled([this.labClosing,lab.close()]);const groups=this.groupDispatch;this.groupDispatch=null;if(groups){this.groupClosing=this.groupClosing.then(()=>groups.close());void this.groupClosing.catch(()=>{});}clearTimeout(this.agentTimer);this.agentTimer=null;const tasks=this.agentTasks;this.agentTasks=null;if(tasks)this.agentClosing=Promise.allSettled([this.agentClosing,tasks.close().finally(()=>tasks.executor.close())]);const media=this.media;this.media=null;if(media)this.mediaClosing=Promise.allSettled([this.mediaClosing,media.close()]);this.connector?.close();this.connector=null;this.controller=null;}
  enqueue(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
  async start(){return this.enqueue(async()=>{if(this.settings.enabled&&!this.settings.cancelPending&&!this.closed&&!this.connector&&!this.timer){try{this.open();await this.tick();}catch(e){this.fail(e);}}return this.snapshot();});}
  open(){if(!this.connector){const config=this.settings.config;this.connector=this.makeConnector({stateDir:path.join(this.directory,'identity'),config:{...config,clientVersion:this.version},ca:this.ca(config),mediaEnabled:Boolean(this.mediaFactory&&this.discoverDevices),agentEnabled:Boolean(this.agentExecutorFactory)});this.controller=new AbortController();}}
  fail(e){this.error=/^[A-Z][A-Z0-9_]{1,63}$/.test(e.code||'')?e.code:'CONNECTION_FAILED';this.phase=TERMINAL.has(e.code)?'revoked':/EXPIRED/.test(this.error)?'expired':'error';if(TERMINAL.has(e.code)){this.settings.enabled=false;this.settings.terminalReason=this.error;this.persist();}this.release();}
  schedule(seconds){if(!this.closed&&this.settings.enabled)this.timer=setTimeout(()=>{void this.enqueue(()=>this.tick());},seconds*1000);}
  async tick(){
    if(this.closed||!this.settings.enabled)return;
    try{this.open();this.phase='connecting';const status=this.connector.session ? this.connector.status() : await this.connector.connect(this.controller.signal);
      if(!this.settings.enabled||this.closed)return;
      if(status.phase==='pending'){this.phase='pending';this.error=null;this.schedule(15);return;}
      const beat=await this.connector.heartbeat(this.controller.signal);if(!this.settings.enabled||this.closed)return;
      const heartbeatIntervalSec=this.connector.session.heartbeatIntervalSec;
      if(this.discoverDevices&&beat.deviceSnapshot){
        try{
          this.deviceReporter??=new (require('./device-snapshot.cjs').DeviceSnapshot)(path.join(this.directory,'devices'));
          const result=await this.deviceReporter.publish(this.connector,beat.deviceSnapshot,this.discoverDevices,AbortSignal.any([this.controller.signal,AbortSignal.timeout(20000)]));
          this.deviceSnapshotState={status:result.discoveryStatus==='ok'?'reported':'discovery-failed',revision:result.revision,installed:result.installed};
        }catch(e){this.deviceSnapshotState={status:'error',errorCode:/^[A-Z][A-Z0-9_]{1,63}$/.test(e.code||'')?e.code:'DEVICE_SNAPSHOT_FAILED'};if(TERMINAL.has(e.code))throw e;}
        if(!this.settings.enabled||this.closed||this.controller.signal.aborted)return;
      }else if(this.discoverDevices)this.deviceSnapshotState={status:'server-unavailable'};
      if(this.media?.finished){await this.media.close();this.media=null;}
      if(this.mediaFactory&&this.deviceReporter&&!this.media){
        await this.mediaClosing;if(!this.settings.enabled||this.closed||this.controller.signal.aborted)return;
        const options=this.mediaFactory({config:this.settings.config});
        this.media=new (require('./media-client.cjs').ClientMedia)({...options,diagnosticsPath:path.join(this.directory,'media-diagnostics.jsonl'),connector:this.connector,signal:this.controller.signal,ca:this.ca(this.settings.config),resolveDevice:(id,signal)=>this.deviceReporter.resolvePreviewDevice(id,signal),onState:state=>{this.mediaState=state;}}).start();
      }
      if(this.agentExecutorFactory&&!this.agentTasks){
        await this.agentClosing;if(this.closed||this.controller.signal.aborted)return;
        const folder=path.join(this.directory,'agent-tasks',this.connector.state.clientId);
        this.agentTasks=new (require('./agent-tasks.cjs').AgentTasks)({directory:folder,connector:this.connector,executor:this.agentExecutorFactory(path.join(folder,'executor'))});
        const tasks=this.agentTasks,signal=this.controller.signal;
        const poll=async()=>{if(this.agentTasks!==tasks||signal.aborted)return;try{await tasks.tick(signal);this.agentState={status:'reconciled'};}catch(e){const errorCode=/^[A-Z][A-Z0-9_]{1,63}$/.test(e.code||'')?e.code:'AGENT_RECONCILE_FAILED';if(this.agentState.errorCode!==errorCode)console.warn('[cluster-agent]',errorCode);this.agentState={status:'error',errorCode};}finally{if(this.agentTasks===tasks&&!signal.aborted)this.agentTimer=setTimeout(poll,1000);}};
        void poll();
      }
      if(this.groupServiceFactory&&this.deviceReporter){
        try{
          this.groupService??=this.groupServiceFactory({directory:path.join(this.directory,'groups',this.connector.state.clientId),clientId:this.connector.state.clientId,snapshot:this.deviceReporter,discover:this.discoverDevices});
          let publishError;try{await this.groupService.publish(this.connector,this.controller.signal);}catch(e){publishError=e;}this.groupState={status:'reported'};
          if(this.groupDispatchFactory){
            await this.groupClosing;
            this.groupDispatch??=this.groupDispatchFactory({directory:path.join(this.directory,'group-inbox',this.connector.state.clientId),connector:this.connector,service:this.groupService});
            this.groupState={status:'reported',dispatch:await this.groupDispatch.tick(this.controller.signal)};
          }
          if(publishError)throw publishError;
        }catch(e){this.groupState={status:'error',errorCode:e.code||'GROUP_RECONCILIATION_REQUIRED'};if(TERMINAL.has(e.code))throw e;}
      }
      if(this.labFactory&&this.groupService&&this.deviceReporter&&!this.lab){await this.labClosing;if(!this.controller.signal.aborted)this.lab=this.labFactory({connection:this,onState:state=>{this.labState=state;}}).start(this.controller.signal);}
      this.settings.registered=true;this.persist();this.phase='connected';this.error=null;this.lastUpdatedAt=new Date().toISOString();this.schedule(heartbeatIntervalSec);
    }catch(e){if(this.controller?.signal.aborted)return;this.fail(e);this.schedule(15);}
  }
  invoke(action,input){
    if(!['register','unregister'].includes(action))return this.invokeQueued(action,input);
    if(this.operations.has(action))return this.operations.get(action);
    if(action==='register'&&this.settings.enrolled&&!this.settings.registered&&this.settings.enabled&&['pending','connecting'].includes(this.phase))return Promise.resolve(this.snapshot());
    const operation=this.invokeQueued(action,input).finally(()=>{if(this.operations.get(action)===operation)this.operations.delete(action);});
    this.operations.set(action,operation);return operation;
  }
  async invokeQueued(action,input){
    // Disable aborts in-flight network before joining the serial mutation queue.
    const generation=['register','unregister','disable','enable'].includes(action)?++this.intentGeneration:this.intentGeneration;
    if(action==='disable'||action==='unregister'){this.settings.enabled=false;this.stop();}
    if(action==='unregister'){this.settings.cancelPending=true;this.persist();}
    return this.enqueue(async()=>{
      try{
        if(this.closed)throw new ConnectorError('SERVICE_CLOSED');
        if(['register','unregister','enable'].includes(action)&&generation!==this.intentGeneration)throw new ConnectorError('ABORTED');
        if(action==='status')return this.snapshot();
        if(action==='save'){
          const config=this.validate(input);const old=this.settings.config;
          if(this.settings.identityBound&&old&&['serverUrl','orgKey','projectKey','apiMode'].some(k=>old[k]!==config[k]))throw new ConnectorError('IDENTITY_SCOPE_BOUND');
          this.stop();this.release();await this.mediaClosing;this.settings.config=config;this.settings.enabled=false;this.persist();this.phase='disabled';this.error=null;
        }else if(action==='test'){
          const config=this.validate(input);const request=this.transport({serverUrl:config.serverUrl,ca:this.ca(config),apiMode:config.apiMode,allowInsecureHttp:config.allowInsecureHttp});
          const result=await request('GET','/v1/healthz',undefined,undefined,AbortSignal.timeout(10000));
          if(result.contractVersion!=='0.1.6'||result.status!=='ok')throw new ConnectorError('CONTRACT_MISMATCH');return {...this.snapshot(),tested:true};
        }else if(action==='register'){
          if(this.settings.cancelPending)throw new ConnectorError('CANCEL_PENDING');
          if(this.settings.terminalReason)throw new ConnectorError('IDENTITY_TERMINAL');
          if(input){const config=this.validate(input),old=this.settings.config;if(this.settings.identityBound&&old&&['serverUrl','orgKey','projectKey','apiMode'].some(k=>old[k]!==config[k]))throw new ConnectorError('IDENTITY_SCOPE_BOUND');this.settings.config=config;}
          if(!this.settings.config)throw new ConnectorError('CONFIG_REQUIRED');
          this.stop();this.release();await this.mediaClosing;this.open();this.phase='connecting';this.error=null;
          // Persist intent before sending: a lost response must not permit a different scope or a new identity.
          this.settings.identityBound=true;this.settings.enrolled=true;this.settings.enabled=true;this.persist();
          const enrolled=await this.connector.enroll(this.controller.signal);if(enrolled?.phase==='approved'){this.settings.registered=true;this.persist();}await this.tick();
        }else if(action==='unregister'){
          this.settings.cancelPending=true;this.persist();this.release();await this.mediaClosing;this.phase='unregistering';this.error=null;
          try{this.open();if(typeof this.connector.unregister!=='function')throw new ConnectorError('UNREGISTER_UNAVAILABLE');await this.connector.unregister(this.controller.signal);this.settings.enrolled=false;this.settings.registered=false;this.settings.cancelPending=false;delete this.settings.cancelError;delete this.settings.terminalReason;this.persist();this.release();this.phase='unregistered';this.error=null;this.lastUpdatedAt=null;}
          catch(e){this.release();this.settings.cancelError=/^[A-Z][A-Z0-9_]{1,63}$/.test(e.code||'')?e.code:'CONNECTION_FAILED';this.persist();this.phase='cancel_failed';this.error=this.settings.cancelError;throw e;}
        }else if(action==='enable'){
          if(this.settings.cancelPending)throw new ConnectorError('CANCEL_PENDING');
          if(!this.settings.enrolled)throw new ConnectorError('REGISTRATION_REQUIRED');
          this.settings.enabled=true;this.persist();this.stop();this.release();await this.mediaClosing;await this.tick();
        }else if(action==='disable'){
          this.release();await this.mediaClosing;this.persist();this.phase='disabled';this.error=null;
        }else throw new ConnectorError('ACTION_INVALID');
        return this.snapshot();
      }catch(e){if(['register','enable'].includes(action)&&generation===this.intentGeneration){this.fail(e);this.schedule(15);}return {success:false,errorCode:/^[A-Z][A-Z0-9_]{1,63}$/.test(e.code||'')?e.code:'CONNECTION_FAILED',...{phase:this.phase}};}
    });
  }
  async close(){this.closed=true;this.stop();await this.queue;this.release();await this.mediaClosing;await this.agentClosing;await this.groupClosing;await this.labClosing;if(this.groupService){await this.groupService.close();this.groupService=null;}}
}
module.exports={DesktopConnection};
