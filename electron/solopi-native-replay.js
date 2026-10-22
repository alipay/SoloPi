const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {buildNativeCase,nativeCaseIssues}=require('./solopi-native-case');
const TERMINAL=new Set(['passed','failed','cancelled']);
const fail=(message,receipt)=>Object.assign(Error(message),{code:'SOLOPI_REPLAY_FAILED',receipt,stdout:JSON.stringify(receipt||{})});
function checkRun(status){
 if(status?.success!==true||typeof status.active!=='boolean'||typeof status.terminal!=='boolean'||!['idle','running','cancel_requested','passed','failed','cancelled'].includes(status.state))throw fail('SoloPi 回放状态协议无效',status);
 if(status.terminal!==TERMINAL.has(status.state)||status.active!==['running','cancel_requested'].includes(status.state))throw fail('SoloPi 回放状态不一致',status);
 return status;
}
async function executeNativeReplay({entry,read,invoke,command,shell,signal,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 const doc=buildNativeCase(entry.nativeCase),issues=nativeCaseIssues(doc);
 if(issues.length)throw fail('原生动作参数未完整配置：'+issues.map(i=>`${i.index+1}: ${i.reason}`).join('；'));
 const timeout=Number(entry.runTimeoutMs??600000);
 if(!Number.isSafeInteger(timeout)||timeout<100||timeout>3600000)throw fail('原生回放时限须在 100–3600000ms 之间');
 const token=randomUUID(),caseName=`desktop-native-${token}`,requestId=`replay-${token}`;
 doc.caseName=caseName;doc.targetAppPackage=entry.targetPackage||doc.targetAppPackage;
 let directory,remote,runId,dispatched=false,imported=false,changedAutoStart=false,completed=false;
 const warnings=[];
 const poll=async(fn,ms,message)=>{const end=now()+ms;while(now()<end){signal.throwIfAborted();const value=await fn();if(value)return value;await pause(250);}throw fail(message,{requestId,runId,caseName});};
 try{
  const capabilities=await read('harness',{type:'capabilities'});
  if(capabilities?.success!==true||!['replay','cancel','config','case-import','case-delete'].every(c=>capabilities.commands?.includes(c))||!['health','status','case','case-import-status','case-delete-status'].every(q=>capabilities.queries?.includes(q)))throw fail('手机 SoloPi 不具备完整原生回放协议，请更新录制组件');
  const recording=await read('record',{recordMode:'status'});
  if(recording?.success!==true||recording.active!==false)throw fail('手机录制仍在运行或状态不明，未启动回放',recording);
  const before=checkRun(await read('harness',{type:'status'}));
  if(before.active)throw fail('手机已有其他回放，未接管',before);
  const health=await read('harness',{type:'health'});
  if(health?.success!==true||health.appInitialized!==true)throw fail('手机 SoloPi 尚未初始化',health);
  const host=health.executionProfiles?.host;
  if('executionProfiles' in health&&(!host||!Array.isArray(host.requiredPermissions)||host.replayMode!=='headless'||host.requiredPermissions.length!==2||!['adb','accessibility'].every(p=>host.requiredPermissions.includes(p))||!Array.isArray(host.advisoryPermissions)||host.advisoryPermissions.length!==1||host.advisoryPermissions[0]!=='powerSave'||typeof host.ready!=='boolean'))throw fail('手机电脑执行能力声明不匹配',health);
  const required=host?['adb','accessibility']:['adb','float','background','powerSave','accessibility'];
  const missing=required.filter(key=>health.permissions?.[key]!==true);
  if(missing.length)throw fail(`请先在手机完成 SoloPi 授权：${missing.join('、')}`,{missingPermissions:missing});
  if(doc.operationLog.steps.some(s=>s.operationNode?.nodeType==='CaptureTree')){
   const plugins=await read('plugin',{action:'list'});
   if(plugins?.success!==true||!plugins.plugins?.some(p=>p.name==='hulu_imageCompare'&&p.runtimeLoaded===true))throw fail('原生截图定位需要手机已有 hulu_imageCompare 插件，尚未加载；未启动回放');
  }
  if(!host&&health.autoStart!==true){
   changedAutoStart=true;
   await invoke('config',{key:'KEY_REPLAY_AUTO_START',value:'true'});
   await poll(async()=> (await read('harness',{type:'health'})).autoStart===true,5000,'SoloPi 未确认自动回放配置');
  }
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'solopi-replay-'));
  const file=path.join(directory,'case.json');
  // Phone import expects operationLog to be a JSON string, not an arbitrary file path.
  const payload={...doc,operationLog:JSON.stringify(doc.operationLog)};
  if(Buffer.byteLength(JSON.stringify(payload))>10*1024*1024)throw fail('原生用例超过 10 MiB');
  await fs.writeFile(file,JSON.stringify(payload),{mode:0o600});
  remote=`/sdcard/Android/data/com.alipay.hulu/files/harness-import/${token}.json`;
  await shell(['mkdir','-p','/sdcard/Android/data/com.alipay.hulu/files/harness-import']);
  await command(['push',file,remote]);
  await invoke('harness',{type:'case-import',path:remote,replace:'false',requestId:token});
  const importedReceipt=await poll(async()=>{const r=await read('harness',{type:'case-import-status',requestId:token});return r.requestId===token&&r.errorCode!=='import_receipt_not_found'?r:null;},15000,'SoloPi 未确认本次用例导入');
  if(importedReceipt.success!==true)throw fail('SoloPi 原生用例导入失败',importedReceipt);imported=true;
  const found=await read('harness',{type:'case',caseName});
  const native=found?.case;
  if(found.success!==true||native?.caseName!==caseName||!Number.isSafeInteger(native.id)||native.id<=0||!/^[a-f0-9]{64}$/.test(native.caseFingerprint||''))throw fail('SoloPi 用例指纹/身份未匹配，未执行',{caseName:native?.caseName,id:native?.id,caseFingerprint:native?.caseFingerprint});
  // Recheck immediately before dispatch; preparation cannot acquire another app's run.
  const last=checkRun(await read('harness',{type:'status'}));
  if(last.active||last.runId!==before.runId)throw fail('准备期间手机回放归属已变化，未启动',last);
  dispatched=true;
  await invoke('replay',{replayMode:'normal',caseName,caseId:String(native.id),caseFingerprint:native.caseFingerprint,requestId,restartApp:String(entry.restartApp!==false),...(host?{headless:'true'}:{})});
  let status=await poll(async()=>{
   const s=checkRun(await read('harness',{type:'status'}));
   if(s.requestId===requestId){if(s.caseName!==caseName||typeof s.runId!=='string'||!s.runId)throw fail('回放回执对应其他用例',s);return s;}
   if(s.runId!==before.runId)throw fail('其他回放抢占了当前请求',s);
   return null;
  },15000,'手机未确认本次回放请求');
  runId=status.runId;
  const end=now()+timeout;
  while(!status.terminal){
   signal.throwIfAborted();if(now()>=end)throw fail('SoloPi 原生回放超时',{...status,timeoutMs:timeout});
   await pause(250);status=checkRun(await read('harness',{type:'status'}));
   if(status.runId!==runId||status.requestId!==requestId||status.caseName!==caseName)throw fail('回放被其他请求替换，未接管新请求',status);
  }
  completed=true;
  if(status.state!=='passed'||!Array.isArray(status.results)||!status.results.length||status.results.some(r=>r.status!=='passed'))throw fail('手机原生回放未通过',status);
  return{success:true,state:'passed',runId,requestId,caseName,results:status.results,operationCount:doc.operationLog.steps.length,warnings};
 }catch(error){
  error.receipt={...error.receipt,requestId,runId,caseName,warnings};error.meta={...(error.meta||{}),soloPi:error.receipt};
  throw error;
 }finally{
  const cleanup=new AbortController(),timer=setTimeout(()=>cleanup.abort(),2200);timer.unref?.();
  try{
   let current;
   try{current=checkRun(await read('harness',{type:'status'},cleanup.signal));}catch(e){warnings.push('无法核对回放收尾状态：'+e.message);}
   const owns=current?.requestId===requestId&&current?.caseName===caseName&&(!runId||current.runId===runId);
   if(dispatched&&!completed&&owns&&current.active){
    runId=current.runId;
    await invoke('harness',{type:'cancel',runId},cleanup.signal);
    const end=now()+1200;
    while(now()<end){cleanup.signal.throwIfAborted();current=checkRun(await read('harness',{type:'status'},cleanup.signal));if(current.runId!==runId||current.requestId!==requestId)throw Error('回放归属变化，未继续清理');if(current.terminal)break;await pause(150);}
    if(!current.terminal)throw Error('未确认手机回放停止');
   }else if(dispatched&&!completed&&!owns)warnings.push('未确认本次回放归属，未停止其他回放');
   if(changedAutoStart&&current&&!current.active)await invoke('config',{key:'KEY_REPLAY_AUTO_START',value:'false'},cleanup.signal);
   if(imported&&current&&!current.active){
    // Only the uniquely named case created by this request is eligible for cleanup.
    const deleteId=`delete-${token}`;
    await invoke('harness',{type:'case-delete',caseName,confirmCaseName:caseName,requestId:deleteId},cleanup.signal);
    const receipt=await read('harness',{type:'case-delete-status',requestId:deleteId},cleanup.signal);
    if(receipt.requestId!==deleteId||receipt.success!==true)warnings.push('临时用例删除尚未得到匹配回执');
   }
   if(remote)await shell(['rm','-f',remote],cleanup.signal).catch(()=>{});
  }catch(e){warnings.push('手机回放收尾未完全确认：'+e.message);}finally{clearTimeout(timer);}
  if(directory)await fs.rm(directory,{recursive:true,force:true});
 }
}
module.exports={executeNativeReplay,checkRun};
