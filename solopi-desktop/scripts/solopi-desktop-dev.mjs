#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {createRequire} from 'node:module';
const development=createRequire(import.meta.url)('../electron/development-tasks');
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const activeStates = new Set(['submitted', 'running', 'stopping']);
const readState = dir => JSON.parse(fs.readFileSync(path.join(dir, 'workflow-editor-state.json'), 'utf8'));
export function assertIdle(dir) {
  const state = readState(dir);
  const active = (state.automationTasks || []).filter(task => activeStates.has(task.status));
  if (active.length) throw new Error(`DEV_TASK_CONFLICT: ${active.map(task => task.id).join(', ')}; stop/wait through the owning CLI first`);
}
export function sourceIdentity() {
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
  const hash = crypto.createHash('sha256');
  for (const dir of ['electron', 'scripts']) {
    const walk = base => fs.readdirSync(base, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name)).forEach(entry=>{
      const file=path.join(base,entry.name);
      if(entry.isDirectory()) walk(file);
      else if(/\.(?:js|mjs|cjs)$/.test(file)) hash.update(path.relative(root,file)).update(fs.readFileSync(file));
    });
    walk(path.join(root,dir));
  }
  return { mode: 'development', commit, sourceSha256: hash.digest('hex') };
}
export async function prepare(sourceDir, dataDir, caseIds) {
  sourceDir=fs.realpathSync(sourceDir);
  if(!dataDir){fs.mkdirSync(development.tempRoot(),{recursive:true,mode:0o700});dataDir=path.join(development.tempRoot(),crypto.randomUUID());}
  dataDir=path.resolve(dataDir);
  if (dataDir === sourceDir || dataDir.startsWith(sourceDir + path.sep) || sourceDir.startsWith(dataDir + path.sep)) throw new Error('Development dataDir must be separate from the installed data directory');
  if (!caseIds.length) throw new Error('At least one --case-id is required');
  if(fs.existsSync(dataDir)) throw new Error('Development dataDir already exists; choose a new directory');
  assertIdle(sourceDir);
  process.env.GLASSBOX_CLI_DATA_DIR=sourceDir;
  process.env.GLASSBOX_WORKFLOW_STATE_PATH=path.join(sourceDir,'workflow-editor-state.json');
  const {getTaskCasesFromCommand,validateExecutableTaskSelectionForCli}=await import('./glassbox-cli.mjs');
  const selection=getTaskCasesFromCommand(['run','task',...caseIds.flatMap(id=>['--case-id',id])]);
  if(selection.missingCaseIds.length) throw new Error(`Missing cases: ${selection.missingCaseIds.join(', ')}`);
  const validation=validateExecutableTaskSelectionForCli(selection);
  if(!validation.success) throw new Error(JSON.stringify(validation.validationErrors));
  const original=readState(sourceDir);
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(dataDir,'.metadata_never_index'),'');
  const assetDir=path.join(dataDir,'assets');fs.mkdirSync(assetDir);
  const copied=new Map();
  const copyValue=(value,base)=>{
    if(Array.isArray(value)) return value.map(v=>copyValue(v,base));
    if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copyValue(v,base)]));
    if(typeof value !== 'string' || !value || value.includes('\n') || value.includes('{{') || value.includes('${')) return value;
    const candidate=path.isAbsolute(value)?value:path.resolve(base,value);
    if(!fs.existsSync(candidate)||!fs.statSync(candidate).isFile())return value;
    if(!copied.has(candidate)){
      const digest=crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
      const target=path.join(assetDir,digest+path.extname(candidate));fs.copyFileSync(candidate,target);copied.set(candidate,target);
    }
    return copied.get(candidate);
  };
  const cases=selection.cases.map(c=>{
    const used=new Set(c.steps.filter(s=>s.type==='component').map(s=>s.componentId));
    return {...copyValue({...c,components:(c.components||[]).filter(component=>used.has(component.id))},c.assetBaseDir||sourceDir),assetBaseDir:dataDir};
  });
  const state={cases,components:[],caseEdges:Object.fromEntries(caseIds.map(id=>[id,selection.caseEdges[id]||[]])),nodePositions:Object.fromEntries(caseIds.map(id=>[id,selection.nodePositions[id]||{}])),deviceBindings:original.deviceBindings||{},llmProviders:original.llmProviders||[],selectedLlmProviderId:original.selectedLlmProviderId||'',automationTasks:[]};
  fs.writeFileSync(path.join(dataDir,'workflow-editor-state.json'),JSON.stringify(state,null,2),{mode:0o600});
  const config=path.join(sourceDir,'environment-config.json');if(fs.existsSync(config))fs.copyFileSync(config,path.join(dataDir,'environment-config.json'));
  const manifest={schemaVersion:'lenswiper.dev-workspace.v1',sourceDataDir:sourceDir,dataDir,preparedAt:new Date().toISOString(),caseIds,caseSourceRevision:selection.sourceRevision,assetCount:copied.size,...sourceIdentity()};
  fs.writeFileSync(path.join(dataDir,'dev-workspace.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  development.registerWorkspace(dataDir,sourceDir);
  return {success:true,...manifest};
}
export async function main(args) {
  const option=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]||'';};
  if(args.includes('--help')||!args.length){console.log('npm run dev:cli -- prepare --source-data-dir <installed-data> --data-dir <new-isolated-dir> --case-id <id>\nnpm run dev:cli -- --data-dir <dir> devices list|run task ...|tasks show/stop ...|reports show ...\nReport import: node scripts/glassbox-cli.mjs reports import <file.glassreport> --app /Applications/solopi-desktop.app --json');return;}
  const dataDir=option('--data-dir')?path.resolve(option('--data-dir')):'';
  if(!dataDir && args[0]!=='prepare')throw new Error('--data-dir is required; use the temporary workspace returned by prepare');
  if(args[0]==='prepare'){
    if(!option('--source-data-dir'))throw new Error('--source-data-dir is required');
    const ids=args.flatMap((v,i)=>v==='--case-id'?[args[i+1]]:[]);
    console.log(JSON.stringify(await prepare(option('--source-data-dir'),dataDir,ids),null,2));return;
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(dataDir,'dev-workspace.json'),'utf8'));
  if(manifest.schemaVersion!=='lenswiper.dev-workspace.v1'||fs.realpathSync(dataDir)===fs.realpathSync(manifest.sourceDataDir))throw new Error('Invalid isolated workspace');
  const command=args.filter((v,i)=>v!=='--data-dir'&&args[i-1]!=='--data-dir');
  if(command[0]==='run'){assertIdle(manifest.sourceDataDir);assertIdle(dataDir);}
  const env={...process.env,GLASSBOX_CLI_DATA_DIR:dataDir,LENSWIPER_TASK_UI_DATA_DIR:manifest.sourceDataDir,GLASSBOX_WORKFLOW_STATE_PATH:path.join(dataDir,'workflow-editor-state.json'),GLASSBOX_WORKFLOW_RUNS_DIR:path.join(dataDir,'logs','workflow-runs'),LENSWIPER_DEV_RUN:'1',LENSWIPER_EXECUTION_PROVENANCE:JSON.stringify({...sourceIdentity(),caseSourceRevision:manifest.caseSourceRevision})};
  delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(process.execPath,[path.join(root,'scripts/glassbox-cli.mjs'),...command],{cwd:root,env,stdio:'inherit'});
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(JSON.stringify({success:false,error:error.message}));process.exitCode=1;});
