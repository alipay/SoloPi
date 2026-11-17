import {lab} from './lab';
// Reads the existing Desktop task. Opening this page never creates an execution.
export async function readDesktop(clientId:string,tool:string,args:Record<string,unknown>,signal:AbortSignal,request?:{requestId:string;submitted?:boolean;settled?:boolean}){
 if(!['list_tasks','read_case_artifact','read_task_report','read_performance_report','read_case_results','search_task_log'].includes(tool))throw Error('Read-only Client task tool required');
 const started=performance.now();let polls=0;
 const control=request||{requestId:crypto.randomUUID(),submitted:false,settled:false},requestId=control.requestId;
 const telemetry=(status:string,code?:string)=>{void lab('diagnostics/events',{event:status==='succeeded'?'web.read.completed':'web.read.failed',requestId,clientId,taskId:args.taskId,caseId:args.caseId,toolName:tool,durationMs:performance.now()-started,status,polls,code},AbortSignal.timeout(3000)).catch(()=>{});};
 try {
 if(!control.submitted){control.submitted=true;await lab('commands',{requestId,clientId,tool,args},signal);}
 for(let i=0;i<150;i++){
  polls++;signal.throwIfAborted();
  const receipt=await lab<any>('commands/'+requestId,undefined,signal);
  if(['succeeded','failed'].includes(receipt.status)){
   control.settled=true;
   if(receipt.status==='failed'||receipt.result?.success===false)throw Object.assign(Error(receipt.result?.error||receipt.result?.errorCode||'Desktop 未能读取报告'),{code:receipt.result?.errorCode});
   const result=receipt.result,id=result.identity?.taskId||result.taskId||result.task?.id||result.executionReceipt?.taskId;
   if(tool==='read_performance_report'){if((id&&id!==args.taskId)||result.target!==args.target||!Array.isArray(result.samples))throw Error('Client performance identity mismatch');}
   if(tool!=='list_tasks'&&tool!=='read_performance_report'&&id!==args.taskId)throw Error('Client task identity mismatch');
   if(args.caseId&&(result.identity?.caseId||result.scope?.caseId)!==args.caseId)throw Error('Client case identity mismatch');
   telemetry('succeeded');return result;
  }
  await new Promise<void>((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',cancel);resolve();},timer=setTimeout(done,i<10?150:400),cancel=()=>{clearTimeout(timer);reject(signal.reason);};signal.addEventListener('abort',cancel,{once:true});});
 }
 throw Object.assign(Error('Desktop 尚未返回报告，请稍后刷新；不会重新执行测试。'),{code:'CLIENT_READ_TIMEOUT'});
 }catch(e){telemetry(signal.aborted?'cancelled':'failed',(e as {code?:string}).code||'CLIENT_READ_FAILED');throw Object.assign(e instanceof Error?e:Error(String(e)),{requestId});}
}
