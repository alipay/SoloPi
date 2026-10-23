// Native Desktop adapter for SoloPi's Apache-2.0 recording protocol.
// Protocol source: alipay/SoloPi 3b8c146ab80b0325aece65b8ef417136c251869c,
// solopi-skill/scripts/harness/src/solopi_harness/solopi_ai.py.
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash,randomUUID}=require('node:crypto');
const {MAX_BYTES}=require('./solopi-case-converter');
const {ensureSoloPiAdb}=require('./solopi-adb-connection');
const {ensureSoloPiPermissions}=require('./solopi-permissions');
const {executeNativeReplay}=require('./solopi-native-replay');
const PACKAGE='com.alipay.hulu',ACTIVITY='com.alipay.hulu.common.scheme.AdbSchemeActivity';
const shellQuote=value=>`'${String(value).replaceAll("'","'\\''")}'`;
const states=new Set(['idle','starting','recording','stopping','stopped','failed']);
function validateStatus(result){
 if(!result || result.success!==true)throw Object.assign(Error(result?.error || '手机录制组件未就绪，请按手机提示完成授权'),{receipt:result,code:result?.errorCode || 'SOLOPI_NOT_READY'});
 if(result.kind!=='recording'||!states.has(result.state)||typeof result.active!=='boolean'||result.active!==['starting','recording','stopping'].includes(result.state)||result.recording!==(result.state==='recording')||(result.state!=='idle'&&(!result.sessionId||!result.caseName||!result.targetPackage)))throw Error('手机录制状态协议不匹配');
 return result;
}
function request(port,action,params,{signal,timeout=5000}={}){
 return new Promise((resolve,reject)=>{
  const url=new URL(`http://127.0.0.1:${port}/scheme/${action}`);for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const req=http.get(url,{signal,timeout,agent:false},res=>{
   let bytes=0;const chunks=[];
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BYTES){res.destroy();req.destroy(Error('手机录制回执超出大小限制'));}else chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>{if(res.statusCode!==200)return reject(Error(`手机录制服务返回HTTP ${res.statusCode}`));try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('手机录制服务未返回有效JSON'));}});
  });req.once('timeout',()=>req.destroy(Error('手机录制服务响应超时')));req.once('error',reject);
 });
}
function createSoloPiProvider({runAdb,resourcesDirectory,httpRequest=request,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 const controllers=new Map(),finishes=new Set();let closing=false;
 async function command(serial,args,signal,timeout=15000){
  return String(await runAdb(['-s',serial,...args],timeout,signal)).trim();
 }
 const shell=(serial,args,signal)=>command(serial,['shell',args.map(shellQuote).join(' ')],signal);
 async function prepare(serial,signal){
  if(await command(serial,['get-state'],signal)!=='device')throw Error('头部所选手机不在线，请连接后重试');
  let installed;
  try{installed=await shell(serial,['pm','path',PACKAGE],signal);}catch(error){
   // Android pm path returns exit 1 with no output when the package is absent.
   if(error.exitCode!==1||String(error.stdout||'').trim()||String(error.stderr||'').trim()||signal.aborted)throw error;
   installed='';
  }
  const root=resourcesDirectory();let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));}catch{throw Object.assign(Error('Desktop内置录制组件不完整，请更新应用'),{code:'SOLOPI_BUNDLE_MISSING'});}
  if(manifest.packageName!==PACKAGE||!Number.isSafeInteger(manifest.versionCode)||!/^([a-f0-9]{64})$/.test(manifest.sha256))throw Error('内置录制组件清单无效');
  let versionCode=0;
  if(installed.startsWith('package:')){const info=await shell(serial,['dumpsys','package',PACKAGE],signal);versionCode=Number(info.match(/\bversionCode=(\d+)/)?.[1] || 0);}
  if(versionCode<manifest.versionCode){
   const apk=path.join(root,'SoloPi.apk'),bytes=await fs.readFile(apk);
   if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('内置录制组件校验失败，未安装');
   const result=await command(serial,['install','-r',apk],signal,120000);
   if(!/^Success$/m.test(result))throw Error('手机录制组件安装失败：'+result.slice(-500));
  }
 }
 async function execute(entry,operation,args=[]){
  if(closing)throw Error('录制组件正在关闭');
  const controller=new AbortController();controllers.set(controller,entry.id);let port,dispatched=false;
  const signal=controller.signal;let finish;const finished=new Promise(resolve=>{finish=resolve;});finishes.add(finished);
  try{
   if(operation==='record-start'||operation==='replay-case'){
    await prepare(entry.serial,signal);
    if(!(await shell(entry.serial,['pm','path',entry.targetPackage],signal)).startsWith('package:'))throw Error('本次所选应用未安装在所选手机上');
   }
   const openForward=async()=>{const value=Number(await command(entry.serial,['forward','tcp:0','tcp:23342'],signal));if(!Number.isInteger(value)||value<1||value>65535)throw Error('录制组件ADB端口无效');return value;};
   port=await openForward();
   const get=(action,params,requestSignal=signal)=>httpRequest(port,action,params,{signal:requestSignal});
   const invoke=async (params,action='record',requestSignal=signal)=>{
    const uri=new URL(`solopi://startaction/${action}`);for(const [k,v] of Object.entries(params))uri.searchParams.set(k,String(v));
    const output=await shell(entry.serial,['am','start','-n',`${PACKAGE}/${ACTIVITY}`,'-a','android.intent.action.VIEW','-d',uri.toString()],requestSignal);
    if(/Error:|Error type |SecurityException|Permission Denial|unable to resolve intent/i.test(output))throw Error('手机录制入口未能启动：'+output.slice(-400));
   };
   // Stopping, status and export must never relaunch or reset the phone companion.
   // A transient capabilities-probe failure is not evidence that a recording ended.
   if(operation==='record-start'||operation==='replay-case'){
    let ready=false;try{ready=(await get('harness',{type:'capabilities'})).success===true;}catch{}
    if(!ready){
     // The official short-lived scheme entry initializes the companion without
     // navigating through its launcher/homepage. Recording stays protocol-owned.
     await invoke({type:'capabilities'},'harness');
     const deadline=now()+20000;
     while(now()<deadline){signal.throwIfAborted();try{if((await get('harness',{type:'capabilities'})).success===true){ready=true;break;}}catch{}await pause(300);}
    }
    if(!ready)throw Error('手机录制组件未就绪，请在手机完成SoloPi授权后重试');
   }
   const read=async(action,params)=>{
    let last;
    for(let attempt=0;attempt<3;attempt++){
     signal.throwIfAborted();
     try{return await get(action,params);}catch(error){last=error;if(signal.aborted)throw error;if(attempt<2){
      // USB reconnect removes the old local ADB forward. Retrying that port cannot recover.
      const previous=port;port=undefined;
      if(previous)await command(entry.serial,['forward','--remove',`tcp:${previous}`],undefined,3000).catch(()=>{});
      try{port=await openForward();}catch(rebindError){last=rebindError;break;}
      await pause(250);
     }}
    }
    throw Object.assign(Error(`无法读取手机录制服务，录制记录保留，请稍后重试：${last?.message || '连接失败'}`),{code:'SOLOPI_SERVICE_UNAVAILABLE',cause:last});
   };
   const status=async()=>validateStatus(await read('record',{recordMode:'status'}));
   const connectAdb=()=>ensureSoloPiAdb({read,invoke:p=>invoke(p,'harness'),command:args=>command(entry.serial,args,signal),signal,now,pause,rebind:async()=>{
     const previous=port;port=undefined;
     if(previous)await command(entry.serial,['forward','--remove',`tcp:${previous}`],undefined,3000).catch(()=>{});
     port=await openForward();
    }});
   const permissions=mode=>ensureSoloPiPermissions({read,mode,signal,now,pause,shell:words=>shell(entry.serial,words,signal),connectAdb});
   const wait=async(sessionId,terminal,phase)=>{const deadline=now()+30000;while(now()<deadline){signal.throwIfAborted();const result=await status();if(result.sessionId===sessionId&&terminal.includes(result.state))return result;await pause(250);}throw Object.assign(Error('等待手机录制确认超时'),{receipt:{sessionId,phase}});};
   if(operation==='record-status')return await status();
   if(operation==='replay-case'){
    const before=await status();if(before.active)throw Error('手机已有录制，未启动回放');
    await permissions('replay');
    return await executeNativeReplay({entry,signal,now,pause,read:(a,p,s)=>s?get(a,p,s):read(a,p),invoke:(a,p,s)=>invoke(p,a,s||signal),command:(args,s)=>command(entry.serial,args,s||signal,30000),shell:(args,s)=>shell(entry.serial,args,s||signal)});
   }
   if(operation==='record-start'){
    const before=await status();if(before.active)throw Object.assign(Error('手机已有录制会话，未接管或停止'),{receipt:before});
    // Explicit per-attempt override skips Desktop checks, not App startup or ADB connectivity.
    if(entry.skipPermissionPrecheck === true) await connectAdb();
    else {
     await permissions('record');
     const apps=await get('harness',{type:'apps'});
     if(apps.success!==true||!Array.isArray(apps.apps))throw Error('无法读取手机录制组件的应用列表，请检查手机端授权后重试');
     if(!apps.apps.some(app=>app.packageName===entry.targetPackage))throw Object.assign(Error('SoloPi 无法看到本次所选应用。请在手机设置中允许 SoloPi 获取应用列表（应用权限/隐私保护），返回 Desktop 后重试'),{code:'SOLOPI_PERMISSIONS_REQUIRED',permissionCheck:{missing:[{key:'appVisibility',label:'应用列表可见性',action:'在手机隐私设置中允许 SoloPi 获取应用列表后重试'}]}});
    }
    const sessionId=randomUUID();
    try{
     dispatched=true;
     await invoke({recordMode:'normal',targetApp:entry.targetPackage,caseName:entry.providerName,sessionId});
     const result=await wait(sessionId,['recording','failed'],'record-start');if(result.state!=='recording')throw Object.assign(Error(result.error || '手机录制启动失败'),{receipt:{...result,phase:'record-start'}});if(entry.preparationShell){
      // External ADB preparation is not a SoloPi operationAndRecord action.
      await command(entry.serial,['shell',entry.preparationShell],signal,30000);
      const verified=await status();
      if(verified.sessionId!==sessionId||verified.state!=='recording')throw Error('前置命令后录制会话已变化，未进入操作录制');
     }
     return result;
    }catch(error){error.receipt={...error.receipt,sessionId,phase:'record-start'};throw error;}
   }
   if(operation==='record-release'){
    const before=await status();
    if(before.sessionId!==entry.sessionId||before.caseName!==entry.providerName||before.targetPackage!==entry.targetPackage) return {success:true,released:false,reason:'session-changed'};
    if(before.active)throw Error('录制尚未停止，未释放手机录制组件');
    const replay=await read('harness',{type:'status'});
    if(replay?.success!==true||typeof replay.active!=='boolean')throw Error('无法确认手机回放状态，未关闭录制组件');
    if(replay.active)return {success:true,released:false,reason:'replay-active'};
    const latest=await status();
    if(latest.sessionId!==entry.sessionId||latest.active)return {success:true,released:false,reason:'session-changed'};
    await shell(entry.serial,['am','force-stop',PACKAGE],signal);
    return {success:true,released:true};
   }
   if(operation==='record-stop'){
    const sessionId=args[args.indexOf('--session-id')+1],before=await status();if(before.sessionId!==sessionId)throw Error('录制会话归属已变化，未停止其他会话');
    if(['starting','recording'].includes(before.state))await invoke({recordMode:'stop',sessionId});
    const result=await wait(sessionId,['stopped','failed'],'record-stop');if(result.state!=='stopped')throw Object.assign(Error(result.error || '手机未确认停止录制'),{receipt:result});return result;
   }
   if(operation==='case-get'){
    const result=await read('harness',{type:'case',caseName:entry.providerName});if(result.success!==true||!result.case)throw Error(result.error || '手机未返回录制用例');
    const log=typeof result.case.operationLog==='string'?JSON.parse(result.case.operationLog):result.case.operationLog;
    if(!log||typeof log!=='object'||!Array.isArray(log.steps))throw Error('录制用例步骤未完整返回');
    delete log.storePath;return {...result,case:{...result.case,operationLog:log}};
   }
   throw Error('不支持的内置录制操作');
  }catch(error){if(operation==='record-start'&&!dispatched)error.notDispatched=true;throw error;}finally{
   controllers.delete(controller);
   if(port)await command(entry.serial,['forward','--remove',`tcp:${port}`],new AbortController().signal,3000).catch(()=>{});
   finishes.delete(finished);finish();
  }
 }
 return {execute,cancelPending(entryId){for(const [c,id] of controllers)if(entryId === undefined || id === entryId)c.abort();},async close(){closing=true;for(const c of controllers.keys())c.abort();let timer;await Promise.race([Promise.allSettled([...finishes]),new Promise(resolve=>{timer=setTimeout(resolve,2500);})]);clearTimeout(timer);},packageName:PACKAGE};
}
module.exports={createSoloPiProvider,validateStatus,request,PACKAGE};
