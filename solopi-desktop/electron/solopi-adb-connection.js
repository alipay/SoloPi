const {randomUUID}=require('node:crypto');

// The companion owns its RSA key and connection. Desktop only prepares the
// selected USB device and requests a connection through the documented scheme.
async function ensureSoloPiAdb({read,invoke,command,rebind,signal,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 const health=await read('harness',{type:'health'});
 if(health?.success!==true||typeof health.permissions?.adb!=='boolean')throw Error('无法确认 SoloPi 内部 ADB 状态，未开始录制');
 if(health.permissions.adb)return {alreadyConnected:true};
 const config=await read('config',{action:'get',key:'KEY_ADB_SERVER'});
 if(config?.success!==true||!['localhost:5555','127.0.0.1:5555','[::1]:5555'].includes(config.config?.value))throw Error('SoloPi 使用了自定义内部 ADB 地址，请先在手机中检查连接配置；未自动改写配置');
 signal.throwIfAborted();
 const port=await command(['shell','getprop service.adb.tcp.port']);
 if(port!=='5555'){
  // tcpip restarts adbd, invalidating existing forwards. Never target another
  // device, reconnect by IP, kill the shared server, or remove others' forwards.
  await command(['tcpip','5555']);
  const deadline=now()+15000;let online=false;
  while(now()<deadline){signal.throwIfAborted();try{if(await command(['get-state'])==='device'){online=true;break;}}catch(error){signal.throwIfAborted();}await pause(300);}
  if(!online)throw Error('准备手机 ADB 后 USB 连接未恢复，请检查连接后重试');
  await rebind();
 }
 const requestId=randomUUID();
 await invoke({type:'adb-connect',requestId});
 const deadline=now()+30000;
 while(now()<deadline){
  signal.throwIfAborted();
  const result=await read('harness',{type:'adb-connect-status',requestId});
  if(result?.errorCode==='adb_connect_receipt_not_found'){await pause(250);continue;}
  const state=result?.state;
  if(result?.requestId!==requestId||!['connecting','connected','failed'].includes(state)||result.success!==(state!=='failed')||result.connected!==(state==='connected')||result.terminal!==(state!=='connecting'))throw Error('SoloPi 内部 ADB 连接回执不匹配，未开始录制');
  if(state==='failed')throw Object.assign(Error('SoloPi 内部 ADB 连接失败，请在手机确认 RSA 调试授权后重试'),{code:result.errorCode||'SOLOPI_ADB_CONNECTION_FAILED'});
  if(state==='connected'){
   const verified=await read('harness',{type:'health'});
   if(verified?.success!==true||verified.permissions?.adb!==true)throw Error('SoloPi 连接回执成功但 ADB 健康检查未通过，未开始录制');
   return {alreadyConnected:false};
  }
  await pause(250);
 }
 throw Object.assign(Error('等待 SoloPi 内部 ADB 连接超时；如手机出现 RSA 调试授权，请确认后重试'),{code:'SOLOPI_ADB_CONNECTION_TIMEOUT'});
}
module.exports={ensureSoloPiAdb};
