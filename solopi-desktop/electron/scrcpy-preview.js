const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {openScrcpyStream}=require('./scrcpy-stream');
const {previewHealth}=require('./preview-health');
const {createPacketParser,avcCodec,MAX_PACKET}=require('./scrcpy-packets');
// Main forwards compressed access units only. Renderer VideoDecoder owns decode.
function createScrcpyPreview({runtime,allowed,onState=()=>{},spawnProcess=spawn,warmIdleMs=0,startupWarningMs=15000,startupTimeoutMs=45000,record=require('./diagnostics').record,openStream=openScrcpyStream,now=Date.now,healthIntervalMs=500,sourceIdleMs=8000,ackTimeoutMs=3000}){
 const entries=new Map(),subscriptions=new Map();let closed=false;
 const keyFor=(owner,t)=>`${owner}:${t.taskId}:${t.role}`;
 async function stopEntry(e,reason='closed'){
  if(e.stopPromise)return e.stopPromise;record({event:'preview.stop',requestId:e.target.taskId,sessionId:e.sessionId,streamId:e.streamId,category:e.target.role,reason,...previewHealth(e,now(),{sourceIdleMs,ackTimeoutMs})});e.stopped=true;e.controller.abort();
  for(const observer of e.observers || []){try{observer.onError(Object.assign(Error('本地投屏已结束'),{code:'MEDIA_CAPTURE_CLOSED'}));}catch{}}
  e.observers?.clear();
  e.resolveReady?.({success:false,error:e.error || '投屏已停止'});
  e.stopPromise=(async()=>{
   clearInterval(e.metricsTimer);clearTimeout(e.warningTimer);clearTimeout(e.startTimer);
   await e.stream?.close();
   await Promise.all(e.children.map(child=>new Promise(resolve=>{
    if(child.exitCode!==null || child.signalCode)return resolve();
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1000);
    child.once('close',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
   })));
   e.sender.removeListener('destroyed',e.onDestroyed);if(entries.get(e.key)===e)entries.delete(e.key);
  })();return e.stopPromise;
 }
 function attach(e,sessionId){
  e.sessionId=sessionId;e.streamId=randomUUID();e.pendingFrame=null;e.pendingAt=null;
  e.queue=e.gop.slice();e.waitKey=!e.queue.length;e.deliver?.();
 }
 async function start(sender,target,sessionId){
  if(closed)throw Error('投屏服务已关闭');const key=keyFor(sender.id,target),attaching=typeof sessionId==='string'&&sessionId.length>0;
  if(attaching)subscriptions.set(key,sessionId);let previous=entries.get(key);
  if(!previous){const warm=[...entries.values()].find(e=>!e.stopped&&e.owner===sender.id&&e.target.serial===target.serial&&(e.idleSince||!allowed(e.target)));
   if(warm){
    const previousKey=warm.key;entries.delete(previousKey);subscriptions.delete(previousKey);
    warm.key=key;warm.target=target;warm.idleSince=0;
    // Transport reuse must not reuse the old task's first-presentation latch.
    const durationMs=Date.now()-warm.startedAtMs;warm.startedAtMs=Date.now();warm.firstPresented=false;
    warm.deliveredFrames=warm.acknowledgedFrames=warm.renderedFrames=0;
    entries.set(key,warm);previous=warm;
    onState(target,{streamReady:Boolean(warm.streamReady),startedSuccessfully:false,readyAtMs:0,startFailed:false,runtimeFailed:false,error:''});
    record({event:'preview.reuse',requestId:target.taskId,sessionId,durationMs});
   }}
  if(previous?.stopPromise)await previous.stopPromise;
  else if(previous&&previous.target.serial!==target.serial)await stopEntry(previous);
  else if(previous){previous.idleSince=0;if(target.restart===true&&!previous.observers.size){await stopEntry(previous,'user-reconnect');}else{if(attaching)attach(previous,sessionId);return{success:true};}}
  if(process.platform==='win32')throw Error('内嵌 scrcpy 视频流暂不支持 Windows');
  const media=runtime();if(!media.scrcpy)throw Error('缺少 scrcpy 运行时');
  const e={key,owner:sender.id,sender,target,sessionId:subscriptions.get(key)||sessionId||'',streamId:randomUUID(),controller:new AbortController(),children:[],observers:new Set(),stopped:false,logs:'',startedAtMs:Date.now(),queue:[],gop:[],gopBytes:0,waitKey:true,frameSequence:0,deliveredFrames:0,acknowledgedFrames:0,renderedFrames:0};
  e.healthStartedAt=e.lastSourceAt=e.lastAckAt=e.lastSocketAt=now();e.sourcePackets=0;e.sourceBytes=0;e.socketBytesRead=0;e.recoveries=[];
  e.ready=new Promise(resolve=>{e.resolveReady=resolve;});
  e.onDestroyed=()=>{subscriptions.delete(e.key);void stopEntry(e);};entries.set(key,e);
  const send=p=>{if(!e.idleSince&&allowed(e.target)&&!sender.isDestroyed())sender.send('agent:mirror-frame',{sessionId:e.sessionId,...e.target,...p});};
  const fail=(message,stage='startup',code='PREVIEW_FAILED')=>{if(e.stopped)return;
   record({event:'preview.failed',sessionId:e.sessionId,requestId:e.target.taskId,stage,code,durationMs:Date.now()-e.startedAtMs,outputCharacters:e.outputBytes||0,diagnosticText:e.logs,...previewHealth(e,now(),{sourceIdleMs,ackTimeoutMs})});
   e.error=message;onState(e.target,{error:message,startFailed:!e.firstPresented,runtimeFailed:Boolean(e.firstPresented)});send({error:message});void stopEntry(e);
  };
  e.fail=fail;
  e.deliver=()=>{
   if(e.stopped||e.idleSince||!e.sessionId||!allowed(e.target)||e.pendingFrame||!e.queue.length)return;
   const packets=e.queue.splice(0,8),frameId=`${e.streamId}:${++e.frameSequence}`;
   e.pendingFrame=frameId;e.pendingAt=now();e.deliveredFrames+=packets.length;
   send({format:'h264-annexb',streamId:e.streamId,codec:e.codec,packets,frameId});
  };
  try{
   const addChild=child=>{
    e.children.push(child);child.once('error',err=>fail(err.message,'scrcpy',err.code||'SPAWN_ERROR'));
    child.once('close',(code,signal)=>fail(e.logs.trim()||`投屏进程退出（${code??signal}）`,'scrcpy',`EXIT_${code??signal}`));
    const log=chunk=>{e.logs=(e.logs+chunk.toString()).slice(-2000);};child.stderr.on('data',log);child.stdout.on('data',log);
   };
   const accept=createPacketParser(packet=>{
    if(e.stopped)return;e.lastSourceAt=now();e.sourcePackets++;e.sourceBytes+=packet.data.length;e.outputBytes=(e.outputBytes||0)+packet.data.length;
    if(e.healthStage==='source-idle'){e.healthStage='flowing';record({event:'preview.resumed',requestId:e.target.taskId,streamId:e.streamId,category:e.target.role,...previewHealth(e,now(),{sourceIdleMs,ackTimeoutMs})});send({status:'flowing'});}
    if(packet.configuration){e.config=packet.data;e.codec=avcCodec(e.config);e.gop=[];e.gopBytes=0;e.queue=[];e.waitKey=true;e.pendingFrame=null;e.pendingAt=null;e.streamId=randomUUID();return;}
    if(!e.config)return;
    if(packet.type==='key'){
     packet={...packet,data:Buffer.concat([e.config,packet.data])};e.gop=[];e.gopBytes=0;e.queue=[];e.waitKey=false;
    }
    if(e.waitKey)return;
    for(const observer of e.observers){try{observer.onAccessUnit(packet.data,packet.timestamp);}catch{}}
    e.gop.push(packet);e.gopBytes+=packet.data.length;e.queue.push(packet);
    if(e.gop.length>120||e.gopBytes>MAX_PACKET||e.queue.length>120){e.gop=[];e.gopBytes=0;e.queue=[];e.waitKey=true;record({event:'preview.resync',requestId:e.target.taskId});return;}
    if(!e.streamReady){
     e.streamReady=true;clearTimeout(e.startTimer);clearTimeout(e.warningTimer);e.startTimer=null;
     onState(e.target,{streamReady:true});e.resolveReady({success:true,stage:'encoded-stream'});
     record({event:'preview.encoded-ready',requestId:e.target.taskId,durationMs:Date.now()-e.startedAtMs});
    }
    e.deliver();
   },{protocolMajor:()=>e.stream?.protocolMajor||3});
   e.metricsTimer=setInterval(()=>{record({event:'preview.frames',requestId:e.target.taskId,streamId:e.streamId,category:e.target.role,durationMs:5000,socketBytesRead:e.socketBytesRead,socketAgeMs:Math.max(0,now()-e.lastSocketAt),sourcePackets:e.sourcePackets,sourceBytes:e.sourceBytes,decodedFrames:e.renderedFrames,deliveredFrames:e.deliveredFrames,acknowledgedFrames:e.acknowledgedFrames,...previewHealth(e,now(),{sourceIdleMs,ackTimeoutMs})});e.socketBytesRead=e.sourcePackets=e.sourceBytes=0;e.renderedFrames=e.deliveredFrames=e.acknowledgedFrames=0;},5000);e.metricsTimer.unref?.();
   record({event:'preview.start',requestId:target.taskId,sessionId,stage:'first-frame'});
   e.warningTimer=setTimeout(()=>{if(!e.stopped){record({event:'preview.slow-start',requestId:e.target.taskId,stage:'first-frame',durationMs:Date.now()-e.startedAtMs,outputCharacters:e.outputBytes||0});send({status:'connecting'});}},startupWarningMs);
   e.startTimer=setTimeout(()=>fail(`投屏首帧超时（${startupTimeoutMs/1000}秒）`,'first-frame','FIRST_FRAME_TIMEOUT'),startupTimeoutMs);
   sender.once('destroyed',e.onDestroyed);
   e.stream=await openStream(media,target.serial,{spawnProcess,signal:e.controller.signal,onChild:addChild,onMetrics:m=>record({event:'preview.setup',requestId:e.target.taskId,...m}),onError:err=>fail(err.message,'video-socket',err.code||'STREAM_ERROR'),startupTimeoutMs:Math.max(1,startupTimeoutMs-(Date.now()-e.startedAtMs))});
   if(e.stopped){await e.stream.close();throw Error('投屏已停止');}
   e.stream.socket.once('end',()=>fail('视频流已结束','video-socket','STREAM_END'));
   e.stream.socket.once('close',()=>fail('视频连接已断开','video-socket','STREAM_CLOSED'));
   e.stream.socket.on('data',chunk=>{e.lastSocketAt=now();e.socketBytesRead+=chunk.length;try{accept(chunk);}catch(err){fail(err.message,'video-packet',err.code||'INVALID_VIDEO_PACKET');}});
   e.lastSocketAt=now();e.socketBytesRead+=e.stream.first.length;accept(e.stream.first);e.stream.socket.resume();return{success:true};
  }catch(err){fail(err.message,'setup',err.code||'SETUP_ERROR');await stopEntry(e);throw err;}
 }
 async function stop(owner,target,force=false){
  for(const key of subscriptions.keys())if((owner===undefined||key.startsWith(`${owner}:`))&&(!target||key.endsWith(`:${target.taskId}:${target.role}`)))subscriptions.delete(key);
  await Promise.all([...entries.values()].filter(e=>(owner===undefined||e.owner===owner)&&(!target||e.target.taskId===target.taskId&&e.target.role===target.role)).map(e=>{
   // Closing a local window releases only its renderer. Existing remote viewers
   // retain the producer until their own ticket/session is closed.
   if(!closed&&e.observers.size&&!e.stopped){e.sessionId='';e.pendingFrame=null;e.queue=[];e.idleSince||=Date.now();return;}
   if(!force&&warmIdleMs>0&&!e.stopped){e.idleSince||=Date.now();return;}return stopEntry(e);
  }));
 }
 const sweep=setInterval(()=>{for(const e of entries.values()){
  if(!e.stopped&&!e.idleSince&&e.sessionId&&e.streamReady&&allowed(e.target)){
   const at=now(),health=previewHealth(e,at,{sourceIdleMs,ackTimeoutMs});
   if(health.stage!==e.healthStage){e.healthStage=health.stage;record({event:'preview.health',requestId:e.target.taskId,streamId:e.streamId,category:e.target.role,...health});if(health.stage==='source-idle'||health.stage==='presentation-idle')e.sender.send('agent:mirror-frame',{sessionId:e.sessionId,...e.target,status:'idle'});}
   if(health.stage==='ack-timeout'||health.stage==='presentation-idle'){
    e.recoveries=e.recoveries.filter(t=>at-t<60000);
    if(e.recoveries.length<2&&at-(e.lastRecoveryAt??-Infinity)>=ackTimeoutMs){e.recoveries.push(at);record({event:'preview.recover',requestId:e.target.taskId,streamId:e.streamId,category:e.target.role,attempt:e.recoveries.length,...health});e.sender.send('agent:mirror-frame',{sessionId:e.sessionId,...e.target,status:'recovering'});e.lastRecoveryAt=at;attach(e,e.sessionId);}
    else if(e.recoveries.length>=2&&!e.recoveryExhausted){e.recoveryExhausted=true;record({event:'preview.recovery-exhausted',requestId:e.target.taskId,category:e.target.role,...health});e.sender.send('agent:mirror-frame',{sessionId:e.sessionId,...e.target,error:'画面恢复未完成，请重新连接'});}
   }
  }
  if(e.sender.isDestroyed()){void stopEntry(e);continue;}if(!allowed(e.target)||e.idleSince){e.idleSince||=Date.now();if(!e.observers.size&&Date.now()-e.idleSince>=warmIdleMs)void stopEntry(e);}}},healthIntervalMs);sweep.unref?.();
 return{start,stop,subscribeVideo(serial,{signal,onAccessUnit,onError}){
  signal.throwIfAborted();
  const e=[...entries.values()].find(e=>!e.stopped&&e.target.serial===serial&&!e.idleSince&&allowed(e.target));
  if(!e)return null;
  const observer={onAccessUnit,onError};e.observers.add(observer);
  let closed=false;const close=()=>{if(closed)return;closed=true;e.observers.delete(observer);signal.removeEventListener('abort',close);if(e.idleSince&&!e.observers.size)void stopEntry(e);};
  signal.addEventListener('abort',close,{once:true});
  // Replay the current GOP (including SPS/PPS on its keyframe) to late viewers.
  // The observer owns no producer/renderer lease and cannot close the local screen.
  for(const packet of e.gop){if(signal.aborted)break;onAccessUnit(packet.data,packet.timestamp);}
  return{close,parentTaskId:e.target.taskId};
 },acknowledge(owner,target,frameId){
  const e=entries.get(keyFor(owner,target));if(!e||e.stopped)return;
  if(target.streamId===e.streamId){
   if(target.error){e.fail('页面无法解码 H.264：'+String(target.error).slice(0,160),'renderer','H264_DECODE_FAILED');return;}
   const presentedCount=Number.isSafeInteger(target.presentedCount) && target.presentedCount>=0 && target.presentedCount<=10000 ? target.presentedCount : (target.presented ? 1 : 0);
   if(presentedCount){e.lastPresentedAt=now();e.recoveryExhausted=false;e.renderedFrames+=presentedCount;if(!e.firstPresented){e.firstPresented=true;const ms=Date.now()-e.startedAtMs;onState(e.target,{startedSuccessfully:true,readyAtMs:Date.now(),firstFrameMs:ms});record({event:'preview.first-frame',requestId:e.target.taskId,sessionId:e.sessionId,durationMs:ms});e.resolveReady({success:true});}}
  }
  if((target.streamId===undefined||target.streamId===e.streamId)&&e.pendingFrame===frameId){e.pendingFrame=null;e.pendingAt=null;e.lastAckAt=now();e.acknowledgedFrames++;e.deliver();}
 },waitReady(owner,target){return entries.get(keyFor(owner,target))?.ready||Promise.resolve({success:false,error:'投屏未启动'});},async close(){closed=true;clearInterval(sweep);await stop(undefined,undefined,true);}};
}
module.exports={createScrcpyPreview};
