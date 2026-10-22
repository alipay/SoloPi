import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url),{listCases}=require('../electron/agent/case-discovery'),{resolveCaseSelection}=require('../electron/agent/case-selection'),{createTools}=require('../electron/agent/tools');
const fixture=()=>({caseLibraries:[{id:'lib',name:'Library'},{id:'other',name:'Other'}],caseFolders:[{id:'root',libraryId:'lib'},{id:'excluded',libraryId:'lib',parentId:'root'},{id:'nested',libraryId:'lib',parentId:'excluded'},{id:'foreign',libraryId:'other'}],cases:[{id:'keep',libraryId:'lib',folderId:'root'},{id:'hide',libraryId:'lib',folderId:'excluded'},{id:'child',libraryId:'lib',folderId:'nested'},{id:'omit',libraryId:'lib',folderId:'root'},{id:'foreign-case',libraryId:'other',folderId:'foreign'}]});
test('one current scope excludes descendant folders and IDs, ignores stale deleted files and detects same-count drift',()=>{
 const state=fixture(),args={libraryId:'lib',excludeFolderIds:['excluded','excluded'],excludeCaseIds:['omit','already-deleted']};const r=listCases(state,args);
 assert.equal(r.total,1);assert.deepEqual(r.caseIds,['keep']);assert.match(r.selectionRevision,/^[a-f0-9]{64}$/);
 assert.deepEqual(resolveCaseSelection(state,{...args,expectedCaseCount:1,expectedSelectionRevision:r.selectionRevision}),['keep']);
 const replacement=structuredClone(state);replacement.cases[0].id='replacement';assert.throws(()=>resolveCaseSelection(replacement,{...args,expectedCaseCount:1,expectedSelectionRevision:r.selectionRevision}),/范围已变化/);
 assert.equal(listCases(state,{libraryId:'lib',excludeFolderIds:['foreign']}).success,false);
 assert.equal(listCases(state,{excludeCaseIds:['keep']}).success,false);
 assert.throws(()=>resolveCaseSelection(state,{caseIds:['deleted']}),/用例不存在/);
 assert.throws(()=>resolveCaseSelection(state,{libraryId:'lib',excludeFolderIds:['root'],expectedCaseCount:1}),/没有用例/);
});
test('Agent selection and submission use two tool calls without full exports and recheck changes across validation await',async()=>{
 let state=fixture(),change=false;const calls=[];
 const tools=await createTools({readState:()=>state,skillsRoots:()=>[],config:()=>({}),mcp:{},invoke:async(channel,event,payload)=>{calls.push({channel,payload});if(change&&channel==='workflow:validate-task-selection')state={...state,cases:state.cases.filter(c=>c.id!=='keep')};return{success:true,taskId:payload.taskId,task:{caseIds:payload.caseIds}};}})({});
 const list=tools.find(t=>t.name==='list_cases'),submit=tools.find(t=>t.name==='submit_task');const scope={libraryId:'lib',excludeFolderIds:['excluded'],excludeCaseIds:['omit']};const r=await list.execute(scope);const args={...scope,expectedCaseCount:r.total,expectedSelectionRevision:r.selectionRevision};
 const Ajv=require('ajv');assert.equal(new Ajv({strict:false}).validate(submit.schema,args),true);
 assert.equal(new Ajv({strict:false}).validate(submit.schema,{caseIds:['keep'],excludeFolderIds:['excluded']}),false);
 const result=await submit.execute(args,{operationId:'scope'});assert.deepEqual(result.caseIds,['keep']);assert.deepEqual(calls.map(c=>c.channel),['workflow:validate-task-selection','workflow-task:submit']);
 change=true;await assert.rejects(submit.execute(args,{operationId:'changed'}),/没有用例|范围已变化/);assert.equal(calls.filter(c=>c.channel==='workflow-task:submit').length,1);
});
test('CLI discovery and run selection share scope and fingerprint without starting Electron or a task',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scope-cli-'));try{
 const state=fixture();for(const c of state.cases){c.name=c.id;c.steps=[];}const file=path.join(dir,'workflow-editor-state.json');fs.writeFileSync(file,JSON.stringify(state));
 const env={...process.env,GLASSBOX_CLI_DATA_DIR:dir,SOLOPI_DESKTOP_DATA_DIR:dir,GLASSBOX_WORKFLOW_STATE_PATH:file};const cli=path.resolve('scripts/glassbox-cli.mjs');
 const listed=spawnSync(process.execPath,[cli,'cases','list','--library','lib','--exclude-folder','excluded','--exclude-case','omit','--json'],{env,encoding:'utf8'});assert.equal(listed.status,0,listed.stderr);const r=JSON.parse(listed.stdout);assert.equal(r.total,1);
 const code=`import {getTaskCasesFromCommand} from ${JSON.stringify('file://'+cli)};const result=getTaskCasesFromCommand(${JSON.stringify(['run','task','--library','lib','--exclude-folder','excluded','--exclude-case','omit','--expected-count','1','--selection-revision',r.selectionRevision])});console.log(JSON.stringify(result.cases.map(c=>c.id)));`;
 const selected=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8'});assert.equal(selected.status,0,selected.stderr);assert.deepEqual(JSON.parse(selected.stdout),['keep']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('validation groups preserve blocking counts, bounded examples and full evidence reference',()=>{
 const {compactValidation}=require('../electron/agent/validation-summary');const raw={phase:'validation',success:false,validationSummary:{selected:67,passed:29,errors:38,warnings:128},validationErrors:Array.from({length:38},(_,i)=>({caseId:'c'+i,code:'ACTIVITY_COMMAND_MISSING',field:'components.launch.commandTemplate',message:'empty'})),validationWarnings:[]};const before=JSON.stringify(raw);const r=compactValidation(raw,'full-evidence');assert.equal(r.validationGroups.length,1);assert.equal(r.validationGroups[0].count,38);assert.equal(r.validationGroups[0].affectedCaseCount,38);assert.equal(r.evidenceId,'full-evidence');assert.equal(r.submitted,false);assert.deepEqual(r.validationSummary,raw.validationSummary);assert.ok(JSON.stringify(r).length<2500);assert.equal(JSON.stringify(raw),before);
});
