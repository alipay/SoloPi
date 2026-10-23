#!/usr/bin/env node
// Native package gate: real broker/executor, private state, no devices or desktop session.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function createHeadlessSmokeFixture(kind){
 const c={schemaVersion:'glassbox.workflow.v1',id:`headless-${kind}`,name:`Headless gate ${kind}`,steps:[{id:'start',name:'Start',type:'start',device:'pc'},{id:'wait',name:'Wait',type:'wait',device:'pc',config:{durationMs:kind==='stop'?30000:2500}}],components:[]};
 if(kind!=='stop'){
  c.components.push({id:'command',name:'Native command',kind:'pc_command',device:'pc',commandTemplate:kind==='failure'?"/bin/sh -c 'echo EXPECTED_HEADLESS_FAILURE >&2; exit 7'":'/bin/echo HEADLESS_EXECUTION_OK',params:[],timeoutSeconds:5});
  c.steps.push({id:'command',name:'Execute local command',type:'component',device:'pc',componentId:'command',inputs:{}});
 }
 c.steps.push({id:'end',name:'End',type:'end',device:'pc'});return c;
}
export async function verifyLinuxHeadless(directory,output){
if(process.platform!=='linux')throw Error('Native Linux execution required');

fs.mkdirSync(output,{recursive:false,mode:0o700});
const dataDir=path.join(output,'data');fs.mkdirSync(dataDir);
fs.writeFileSync(path.join(dataDir,'workflow-editor-state.json'),JSON.stringify({cases:[],components:[],automationTasks:[]}));
fs.writeFileSync(path.join(dataDir,'environment-config.json'),JSON.stringify({adbPath:'/bin/false'}));
const env={...process.env,SOLOPI_DESKTOP_DATA_DIR:dataDir,GLASSBOX_CLI_DATA_DIR:dataDir,GLASSBOX_WORKFLOW_STATE_PATH:path.join(dataDir,'workflow-editor-state.json'),LENSWIPER_TASK_UI_DATA_DIR:dataDir,ADB_PATH:'/bin/false'};
for(const key of ['DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','LENSWIPER_DEV_RUN','SOLOPI_HARNESS_DESKTOP_DATA_DIR'])delete env[key];
const cli=path.join(directory,'resources/bin/solopi-desktop');
let sequence=0;const checks=[],active=new Set();
function invoke(args){
 const r=spawnSync(cli,[...args,'--json'],{encoding:'utf8',env,timeout:45000,maxBuffer:8*1024*1024});
 fs.writeFileSync(path.join(output,`${++sequence}.stdout.log`),r.stdout||'');fs.writeFileSync(path.join(output,`${sequence}.stderr.log`),r.stderr||'');
 if(r.error||r.signal)throw r.error||Error(`CLI signal ${r.signal}`);
 let d;try{d=JSON.parse(r.stdout);}catch{throw Error(`Invalid CLI JSON at step ${sequence}`);}
 return d;
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function terminal(id){
 const deadline=Date.now()+45000;
 while(Date.now()<deadline){const d=invoke(['tasks','show',id]);if(['success','failed','stopped'].includes(d.task?.status)){active.delete(id);return d.task;}await wait(200);}
 throw Error(`Task did not reach terminal state: ${id}`);
}
function fixture(kind){const file=path.join(output,kind+'.json');fs.writeFileSync(file,JSON.stringify(createHeadlessSmokeFixture(kind)));return file;}
try{
 const discovered=invoke(['cases','list']);
 if(discovered.success===false || !Array.isArray(discovered.cases))throw Error('Packaged case discovery failed before execution');
 for(const kind of ['success','failure','stop']){
  const receipt=invoke(['run','task',fixture(kind),'--task-name',`Headless package gate ${kind}`,'--no-screen-mirror']);
  if(!receipt.success||!receipt.taskId)throw Error(`Submission rejected: ${JSON.stringify(receipt)}`);
  const id=receipt.taskId;active.add(id);
  if(!['submitted','running'].includes(receipt.task?.status))throw Error('Expected an asynchronous task receipt before completion');
  // The submitting CLI is already gone here; the owned broker must remain alive.
  if(kind==='stop'){await wait(300);const stopped=invoke(['tasks','stop',id]);if(stopped.success===false)throw Error('Stop was rejected');}
  const task=await terminal(id);const result=invoke(['tasks','result',id]);
  if(task.status!==kind.replace('failure','failed').replace('stop','stopped'))throw Error(`Unexpected task status: ${task.status}`);
  if(kind==='success'&&result.counts?.success!==1)throw Error('Successful execution was not delivered');
  if(kind==='failure'&&result.counts?.failed!==1)throw Error('Nonzero command failure was not delivered');
  const executed=task.cases?.[0];
  if(kind==='success' && !executed?.results?.some(r=>r.stepId==='command' && r.status==='success' && r.stdout?.includes('HEADLESS_EXECUTION_OK')))throw Error('Native success command did not execute');
  if(kind==='failure' && executed?.diagnostics?.details?.exitCode!==7)throw Error('Expected command exit code was not preserved');
  const report=result.reportPackagePath||task.reportPackage?.path;
  if(!report||!fs.existsSync(report)||!fs.statSync(report).size)throw Error('Missing terminal report');
  checks.push({kind,taskId:id,status:task.status,reportBytes:fs.statSync(report).size});
 }
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({success:true,displayRequired:false,checks},null,2));
 console.log('Native no-display execution passed: async success, command failure, stop and reports.');
}catch(error){fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({success:false,error:error.message,checks},null,2));throw error;}
finally{for(const id of active){try{invoke(['tasks','stop',id]);await terminal(id);}catch(error){console.error('Owned smoke task cleanup failed:',id,error.message);}}}

}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==4)throw Error('Usage: verify-linux-headless.mjs <package-directory> <new-evidence-directory>');
 await verifyLinuxHeadless(path.resolve(process.argv[2]),path.resolve(process.argv[3]));
}
