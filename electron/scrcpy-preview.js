const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {openScrcpyStream}=require('./scrcpy-stream');
const {createPacketParser,avcCodec,MAX_PACKET}=require('./scrcpy-packets');
// Main forwards compressed access units only. Renderer VideoDecoder owns decode.
function createScrcpyPreview({runtime,allowed,onState=()=>{},spawnProcess=spawn,warmIdleMs=0,startupWarningMs=15000,startupTimeoutMs=45000,record=require('./diagnostics').record,openStream=openScrcpyStream}){
 const entries=new Map(),subscriptions=new Map();let closed=false;
 const keyFor=(owner,t)=>`${owner}:${t.taskId}:${t.role}`;
 async function stopEntry(e){
  if(e.stopPromise)return e.stopPromise;e.stopped=true;e.controller.abort();
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
  e.sessionId=sessionId;e.streamId=randomUUID();e.pendingFrame=null;
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
  else if(previous){previous.idleSince=0;if(attaching)attach(previous,sessionId);return{success:true};}
  if(process.platform==='win32')throw Error('内嵌 scrcpy 视频流暂不支持 Windows');
  const media=runtime();if(!media.scrcpy)throw Error('缺少 scrcpy 运行时');
  const e={key,owner:sender.id,sender,target,sessionId:subscriptions.get(key)||sessionId||'',streamId:randomUUID(),controller:new AbortController(),children:[],stopped:false,logs:'',startedAtMs:Date.now(),queue:[],gop:[],gopBytes:0,waitKey:true,frameSequence:0,deliveredFrames:0,acknowledgedFrames:0,renderedFrames:0};
  e.ready=new Promise(resolve=>{e.resolveReady=resolve;});
  e.onDestroyed=()=>{subscriptions.delete(e.key);void stopEntry(e);};entries.set(key,e);
  const send=p=>{if(!e.idleSince&&allowed(e.target)&&!sender.isDestroyed())sender.send('agent:mirror-frame',{sessionId:e.sessionId,...e.target,...p});};
  const fail=(message,stage='startup',code='PREVIEW_FAILED')=>{if(e.stopped)return;
   record({event:'preview.failed',sessionId:e.sessionId,requestId:e.target.taskId,stage,code,durationMs:Date.now()-e.startedAtMs,outputCharacters:e.outputBytes||0,diagnosticText:e.logs});
   e.error=message;onState(e.target,{error:message,startFailed:!e.firstPresented,runtimeFailed:Boolean(e.firstPresented)});send({error:message});void stopEntry(e);
  };
  e.fail=fail;
  e.deliver=()=>{
   if(e.stopped||e.idleSince||!e.sessionId||!allowed(e.target)||e.pendingFrame||!e.queue.length)return;
   const packets=e.queue.splice(0,8),frameId=`${e.streamId}:${++e.frameSequence}`;
   e.pendingFrame=frameId;e.deliveredFrames+=packets.length;
   send({format:'h264-annexb',streamId:e.streamId,codec:e.codec,packets,frameId});
  };
  try{
   const addChild=child=>{
    e.children.push(child);child.once('error',err=>fail(err.message,'scrcpy',err.code||'SPAWN_ERROR'));
    child.once('close',(code,signal)=>fail(e.logs.trim()||`投屏进程退出（${code??signal}）`,'scrcpy',`EXIT_${code??signal}`));
    const log=chunk=>{e.logs=(e.logs+chunk.toString()).slice(-2000);};child.stderr.on('data',log);child.stdout.on('data',log);
   };
   const accept=createPacketParser(packet=>{
    if(e.stopped)return;e.outputBytes=(e.outputBytes||0)+packet.data.length;
    if(packet.configuration){e.config=packet.data;e.codec=avcCodec(e.config);e.gop=[];e.gopBytes=0;e.queue=[];e.waitKey=true;e.streamId=randomUUID();return;}
    if(!e.config)return;
    if(packet.type==='key'){
     packet={...packet,data:Buffer.concat([e.config,packet.data])};e.gop=[];e.gopBytes=0;e.queue=[];e.waitKey=false;
    }
    if(e.waitKey)return;
    e.gop.push(packet);e.gopBytes+=packet.data.length;e.queue.push(packet);
    if(e.gop.length>120||e.gopBytes>MAX_PACKET||e.queue.length>120){e.gop=[];e.gopBytes=0;e.queue=[];e.waitKey=true;record({event:'preview.resync',requestId:e.target.taskId});return;}
    if(!e.streamReady){
     e.streamReady=true;clearTimeout(e.startTimer);clearTimeout(e.warningTimer);e.startTimer=null;
     onState(e.target,{streamReady:true});e.resolveReady({success:true,stage:'encoded-stream'});
     record({event:'preview.encoded-ready',requestId:e.target.taskId,durationMs:Date.now()-e.startedAtMs});
    }
    e.deliver();
   });
   e.metricsTimer=setInterval(()=>{record({event:'preview.frames',requestId:e.target.taskId,durationMs:5000,decodedFrames:e.renderedFrames,deliveredFrames:e.deliveredFrames,acknowledgedFrames:e.acknowledgedFrames});e.renderedFrames=e.deliveredFrames=e.acknowledgedFrames=0;},5000);e.metricsTimer.unref?.();
   record({event:'preview.start',requestId:target.taskId,sessionId,stage:'first-frame'});
   e.warningTimer=setTimeout(()=>{if(!e.stopped){record({event:'preview.slow-start',requestId:e.target.taskId,stage:'first-frame',durationMs:Date.now()-e.startedAtMs,outputCharacters:e.outputBytes||0});send({status:'connecting'});}},startupWarningMs);
   e.startTimer=setTimeout(()=>fail(`投屏首帧超时（${startupTimeoutMs/1000}秒）`,'first-frame','FIRST_FRAME_TIMEOUT'),startupTimeoutMs);
   sender.once('destroyed',e.onDestroyed);
   e.stream=await openStream(media,target.serial,{spawnProcess,signal:e.controller.signal,onChild:addChild,onMetrics:m=>record({event:'preview.setup',requestId:e.target.taskId,...m}),onError:err=>fail(err.message,'video-socket',err.code||'STREAM_ERROR'),startupTimeoutMs:Math.max(1,startupTimeoutMs-(Date.now()-e.startedAtMs))});
   if(e.stopped){await e.stream.close();throw Error('投屏已停止');}
   e.stream.socket.once('end',()=>fail('视频流已结束','video-socket','STREAM_END'));
   e.stream.socket.on('data',chunk=>{try{accept(chunk);}catch(err){fail(err.message,'video-packet',err.code||'INVALID_VIDEO_PACKET');}});
   accept(e.stream.first);e.stream.socket.resume();return{success:true};
  }catch(err){fail(err.message,'setup',err.code||'SETUP_ERROR');await stopEntry(e);throw err;}
 }
 async function stop(owner,target,force=false){
  for(const key of subscriptions.keys())if((owner===undefined||key.startsWith(`${owner}:`))&&(!target||key.endsWith(`:${target.taskId}:${target.role}`)))subscriptions.delete(key);
  await Promise.all([...entries.values()].filter(e=>(owner===undefined||e.owner===owner)&&(!target||e.target.taskId===target.taskId&&e.target.role===target.role)).map(e=>{if(!force&&warmIdleMs>0&&!e.stopped){e.idleSince||=Date.now();return;}return stopEntry(e);}));
 }
 const sweep=setInterval(()=>{for(const e of entries.values()){if(e.sender.isDestroyed()){void stopEntry(e);continue;}if(!allowed(e.target)||e.idleSince){e.idleSince||=Date.now();if(Date.now()-e.idleSince>=warmIdleMs)void stopEntry(e);}}},500);sweep.unref?.();
 return{start,stop,acknowledge(owner,target,frameId){
  const e=entries.get(keyFor(owner,target));if(!e||e.stopped)return;
  if(target.streamId===e.streamId){
   if(target.error){e.fail('页面无法解码 H.264：'+String(target.error).slice(0,160),'renderer','H264_DECODE_FAILED');return;}
   const presentedCount=Number.isSafeInteger(target.presentedCount) && target.presentedCount>=0 && target.presentedCount<=10000 ? target.presentedCount : (target.presented ? 1 : 0);
   if(presentedCount){e.renderedFrames+=presentedCount;if(!e.firstPresented){e.firstPresented=true;const ms=Date.now()-e.startedAtMs;onState(e.target,{startedSuccessfully:true,readyAtMs:Date.now(),firstFrameMs:ms});record({event:'preview.first-frame',requestId:e.target.taskId,sessionId:e.sessionId,durationMs:ms});e.resolveReady({success:true});}}
  }
  if(e.pendingFrame===frameId){e.pendingFrame=null;e.acknowledgedFrames++;e.deliver();}
 },waitReady(owner,target){return entries.get(keyFor(owner,target))?.ready||Promise.resolve({success:false,error:'投屏未启动'});},async close(){closed=true;clearInterval(sweep);await stop(undefined,undefined,true);}};
}
module.exports={createScrcpyPreview};
