const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs');
const {createWorkflowTaskSummary}=require('./workflow-task-sync');
try {
  let state, lastError;
  for(const file of workerData.files) {
    try {state=JSON.parse(fs.readFileSync(file,'utf8'));break;}
    catch(error){if(error.code!=='ENOENT')lastError=error;}
  }
  if(!state && lastError && lastError.code!=='ENOENT')throw lastError;
  parentPort.postMessage({tasks:(state?.automationTasks || []).map(task=>createWorkflowTaskSummary(task))});
} catch(error) {parentPort.postMessage({error:{message:error.message,code:error.code}});}
