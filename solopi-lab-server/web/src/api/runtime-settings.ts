import {lab} from './lab';
export async function desktopSettings(clientId:string,tool:string,args:Record<string,unknown>,signal:AbortSignal){
 const requestId=crypto.randomUUID();
 await lab('commands',{requestId,clientId,tool,args},signal);
 for(let i=0;i<180;i++){
  signal.throwIfAborted();const receipt=await lab<any>('commands/'+requestId,undefined,signal);
  if(receipt.clientId!==clientId)throw Error('配置回执不属于所选电脑，已停止读取');
  if(['failed','succeeded'].includes(receipt.status)){
   if(receipt.status==='failed'||receipt.result?.success===false){if(tool==='agent_runtime_config'&&receipt.result?.errorCode==='PLATFORM_TOOL_NOT_FOUND')throw Error('该电脑尚未加载运行时配置接口。请在当前任务结束后升级或重新打开 solopi-desktop。');throw Error(receipt.result?.error||receipt.result?.errorCode||'电脑未能完成配置请求');}
   return receipt.result;
  }
  await new Promise<void>((resolve,reject)=>{const end=()=>{signal.removeEventListener('abort',cancel);resolve()},t=setTimeout(end,400),cancel=()=>{clearTimeout(t);reject(signal.reason)};signal.addEventListener('abort',cancel,{once:true});});
 }
 throw Error('电脑未在限时内返回。请求标识：'+requestId+'。保存结果可能已生效，请重新读取配置核对。');
}
