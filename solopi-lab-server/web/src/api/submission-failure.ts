import {lab} from './lab';
export type SubmissionFailure={taskId:string;clientId:string;name:string;group:{name:string};cases:{caseId:string;name:string}[];report:{error?:string;validation:{success:false;phase:string;validationErrors:{caseId?:string;caseName?:string;node?:string;code?:string;message?:string}[]}}};
// A missing native report is not evidence of a rejected submission. Require the
// original Server receipt, matching identities, and explicit validation phase.
export async function readSubmissionFailure(clientId:string,taskId:string,signal:AbortSignal):Promise<SubmissionFailure|null>{
 const task=await lab<any>('tasks/'+encodeURIComponent(taskId),undefined,signal);
 if(task.taskId!==taskId||task.clientId!==clientId)throw Error('任务标识不匹配');
 const v=task.report?.validation;
 return task.status==='failed'&&v?.success===false&&v.phase==='validation'&&Array.isArray(v.validationErrors)&&v.validationErrors.length&&Array.isArray(task.cases)?task:null;
}
