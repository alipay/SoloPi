import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire}from'node:module';
const require=createRequire(import.meta.url),local=require('../electron/agent/local-runtime.cjs');
function fixture(t,loggedIn=true){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-runtime-test-'));const old=process.env.PATH,oldConfig=process.env.SOLOPI_RUNTIME_CONFIG;process.env.SOLOPI_RUNTIME_CONFIG=path.join(dir,'runtime-definitions.json');require('../electron/agent/runtime-registry.cjs').save(dir,[{id:'custom-claude',name:'Fixture Claude',command:'fixture-cli',args:[],family:'claude'}]);process.env.PATH=dir+path.delimiter+old;t.after(()=>{process.env.PATH=old;if(oldConfig===undefined)delete process.env.SOLOPI_RUNTIME_CONFIG;else process.env.SOLOPI_RUNTIME_CONFIG=oldConfig;fs.rmSync(dir,{recursive:true,force:true});});fs.writeFileSync(path.join(dir,'codex'),`#!/usr/bin/env node
const readline=require('node:readline');if(process.argv.includes('login'))process.exit(${loggedIn?0:1});if(process.argv.includes('--version')){console.log('codex-cli 1.2.3');process.exit(0);}
const send=v=>console.log(JSON.stringify(v));readline.createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);if(v.id===undefined)return;let result={};if(v.method==='model/list')result={data:[{id:'fixture-model',model:'fixture-model',displayName:'Fixture Model'}],nextCursor:null};if(v.method==='config/read')result={config:{mcp_servers:{foreign:{}}}};if(v.method==='thread/start'){if(v.params.model!=='fixture-model'||v.params.config['features.shell_tool']!==false||v.params.config['mcp_servers.foreign.enabled']!==false)process.exit(9);result={thread:{id:'isolated-thread'}};}send({id:v.id,result});if(v.method==='turn/start'){const prompt=JSON.parse(v.params.input[0].text);const prior=JSON.stringify(prompt.messages).includes('fixture-receipt');const calls=prompt.tools.length&&!prior?[{name:prompt.tools[0].name,arguments:'{}'}]:[];send({method:'item/completed',params:{item:{type:'agentMessage',text:JSON.stringify({text:calls.length?'':'fixture-receipt checked',calls})}}});send({method:'turn/completed',params:{turn:{status:'completed'}}});}});
`,{mode:0o755});return dir;}
test('runtime lists real protocol model identifiers and receives the explicitly selected model',async t=>{fixture(t);const list=await local.models('codex');assert.equal(list.items[0].id,'fixture-model');const r=await local.requestModel({provider:{runtimeId:'codex',model:list.items[0].id},messages:[{role:'user',content:'hello'}]});assert.equal(r.content,'fixture-receipt checked');assert.deepEqual(r.tool_calls,[]);});
test('runtime produces a host tool call; only the host executes it and feeds its result back',async t=>{fixture(t);let runs=0;const tools=[{name:'read_fixture',parameters:{type:'object',properties:{}}}];const r=await local.requestModel({provider:{runtimeId:'codex',model:'fixture-model'},messages:[{role:'user',content:'read'}],tools});assert.equal(r.tool_calls.length,1);assert.equal(runs,0);assert.equal(r.tool_calls[0].function.name,'read_fixture');runs++;const after=await local.requestModel({provider:{runtimeId:'codex',model:'fixture-model'},messages:[{role:'tool',content:'fixture-receipt'}],tools});assert.equal(runs,1);assert.deepEqual(after.tool_calls,[]);assert.match(after.content,/checked/);});
test('strict response validation rejects unknown tools and malformed arguments without executing',()=>{assert.throws(()=>local.parseReply({text:'',calls:[{name:'shell',arguments:'{}'}]},[]),e=>e.code==='RUNTIME_TOOL_UNKNOWN');assert.throws(()=>local.parseReply({text:'',calls:[{name:'known',arguments:'not-json'}]},[{name:'known'}]),e=>e.code==='RUNTIME_ARGUMENTS_INVALID');assert.throws(()=>local.parseReply({text:'',calls:[{name:'known',arguments:'[]'}]},[{name:'known'}]),e=>e.code==='RUNTIME_ARGUMENTS_INVALID');});
test('backend selection survives restart and API switch preserves runtime and API credential files',async t=>{const dir=fixture(t);fs.writeFileSync(path.join(dir,'api-config.json'),'preserved');await local.saveSelection(dir,{mode:'local-runtime',runtimeId:'codex',model:'fixture-model'});assert.deepEqual(local.readSelection(dir),{mode:'local-runtime',runtimeId:'codex',model:'fixture-model'});await local.saveSelection(dir,{mode:'api'});assert.equal(local.readSelection(dir).mode,'api');assert.equal(fs.readFileSync(path.join(dir,'api-config.json'),'utf8'),'preserved');await assert.rejects(()=>local.saveSelection(dir,{mode:'local-runtime',runtimeId:'unknown',model:'x'}),e=>e.code==='RUNTIME_UNSUPPORTED');assert.equal(local.readSelection(dir).mode,'api');});
test('cancellation rejects and closes the owned CLI transport',async t=>{fixture(t);const c=new AbortController();c.abort(Error('cancelled'));await assert.rejects(local.models('codex',{signal:c.signal}),/cancelled/);});

test('missing CLI login fails explicitly without falling back to the API model',async t=>{fixture(t,false);await assert.rejects(()=>local.requestModel({provider:{runtimeId:'codex',model:'fixture-model'},messages:[]}),e=>e.code==='RUNTIME_LOGIN_REQUIRED');});

test('Finder-style PATH discovers installed Codex app CLI while preserving explicit PATH precedence',()=>{
 const paths=local.executableCandidates('codex',{platform:'darwin',home:'/home/user',pathValue:'/explicit/bin'});assert.equal(paths[0],'/explicit/bin/codex');assert.ok(paths.includes('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'));assert.ok(paths.includes('/home/user/Applications/Codex.app/Contents/Resources/codex'));assert.ok(!local.executableCandidates('codex',{platform:'linux',home:'/home/user',pathValue:''}).some(x=>x.includes('.app/')));
});

test('configured model catalog command supplies identifiers without exposing extra fields',async t=>{
 const dir=fixture(t),script=path.join(dir,'catalog.cjs');
 fs.writeFileSync(script,`console.log(JSON.stringify({items:[{id:'fixture-model',name:'Fixture',apiKey:'hidden'}]}));`);
 require('../electron/agent/runtime-registry.cjs').save(dir,[{id:'custom-claude',name:'Fixture Claude',command:process.execPath,args:[],family:'claude',modelsCommand:{command:process.execPath,args:[script]}}]);
 const result=await local.handle(dir,{action:'models',runtimeId:'custom-claude'});assert.equal(result.success,true);assert.equal(result.items[0].id,'fixture-model');assert.equal(result.source,'configured-command');assert.ok(!JSON.stringify(result).includes('hidden'));
});

test('real Agent installation registers runtime configuration for application services and renderer IPC without a renderer sender',async t=>{
 const dir=fixture(t);const renderer=new Map(),services=new Map();
 const agent=require('../electron/agent').installAgent({directory:()=>dir,ipcMain:{handle:(n,h)=>renderer.set(n,h)},registerService:(n,h)=>{services.set(n,h);renderer.set(n,h)},readState:()=>({}),provider:async()=>({}),protect:x=>x,reveal:x=>x,invoke:()=>{}});
 t.after(()=>agent.stopAll());const handler=services.get('agent:runtime-config');assert.equal(typeof handler,'function');assert.equal(renderer.get('agent:runtime-config'),handler);assert.equal((await handler(null,{action:'get'})).selection.mode,'api');
});

test('CLI JSON tolerates terminal cursor/color sequences but does not accept additional documents or arbitrary logs',()=>{
 const value={structured_output:{text:'正文包含转义字符串 \\u001b 与大括号 }',calls:[]},is_error:false};
 assert.deepEqual(local.parseCliJson('\x1b[32m'+JSON.stringify(value)+'\n\x1b[0m\x1b[?25h'),value);
 for(const text of ['{}\n{}','{}\nextra message','{"truncated":','secret-prefix {}'])assert.throws(()=>local.parseCliJson(text),e=>e.code==='RUNTIME_OUTPUT_INVALID'&&!e.message.includes('secret'));
});
test('Configured Claude real subprocess-style JSON with a trailing cursor marker passes connection test and preserves tool calls',async t=>{
 const dir=fixture(t);fs.writeFileSync(path.join(dir,'fixture-cli'),`#!/usr/bin/env node
const fs=require('node:fs');const sys=process.argv[process.argv.indexOf('--system-prompt')+1];if(!process.argv.includes('--disable-slash-commands')||process.argv[process.argv.indexOf('--settings')+1]!==JSON.stringify({disableAllHooks:true}))process.exit(10);if(!sys?.includes('not a coding-agent executor')||!sys.includes('Never invent tool attempts')||process.argv.includes('--json-schema')||process.argv[process.argv.indexOf('--max-turns')+1]!=='2')process.exit(8);const prompt=JSON.parse(fs.readFileSync(0,'utf8'));const tool=prompt.tools[0];process.stdout.write(JSON.stringify({is_error:false,result:JSON.stringify({text:'OK',calls:tool?[{name:tool.name,arguments:{}}]:[]})})+'\\n\\x1b[?25h');
`,{mode:0o755});
 const r=await local.handle(dir,{action:'test',runtimeId:'custom-claude',model:'fixture-model'});assert.deepEqual(r,{success:true,content:'OK'});
 const after=await local.requestModel({provider:{runtimeId:'custom-claude',model:'fixture-model'},messages:[],tools:[{name:'read_fixture'}]});assert.equal(after.tool_calls[0].function.name,'read_fixture');
});

test('portable transport encodes tool arguments while original parameter validation remains authoritative',()=>{
 const Ajv=require('ajv'),tools=[{name:'write_work_file',parameters:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}},{name:'read_work_file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}];
 const validate=new Ajv().compile(local.responseSchema(tools));
 const args={path:'result.md',content:'# 用户方案\n"quoted" \\ path\n'.repeat(600)};
 const reply={text:'',calls:[{name:'write_work_file',arguments:JSON.stringify(args)}]};
 assert.equal(validate(reply),true,JSON.stringify(validate.errors));
 assert.deepEqual(JSON.parse(local.parseReply(reply,tools).tool_calls[0].function.arguments),args);
 assert.equal(validate({text:'',calls:[{name:'write_work_file',arguments:args}]}),false);
 assert.equal(new Ajv().compile(tools[1].parameters)({path:'a',content:'wrong tool'}),false);
 assert.equal(new Ajv().compile(local.responseSchema())({text:'done',calls:[]}),true);
});
test('model text accepts only an entire JSON document or one JSON fence',()=>{const reply={text:'',calls:[{name:'write',arguments:{content:'quoted " \\ newline\n'}}]};assert.deepEqual(local.parseModelJson(JSON.stringify(reply)),reply);assert.deepEqual(local.parseModelJson('```json\n'+JSON.stringify(reply)+'\n```'),reply);for(const value of ['prefix '+JSON.stringify(reply),JSON.stringify(reply)+'\n{}','<tool_call>read</tool_call>'])assert.throws(()=>local.parseModelJson(value),e=>e.code==='RUNTIME_RESPONSE_INVALID');});


test('CLI usage contextWindow metadata never turns a quota or turn-limit failure into context overflow',async t=>{
 const dir=fixture(t);
 const cases=[
  {row:{is_error:true,result:'API Error: Request rejected (429): rate_limit_error',modelUsage:{fixture:{contextWindow:73728}}},code:'RUNTIME_EXIT_FAILED',status:429},
  {exit:0,row:{is_error:true,result:'API Error: Request rejected (429): rate_limit_error',modelUsage:{fixture:{contextWindow:73728}}},code:'RUNTIME_TURN_FAILED',status:429},
  {row:{is_error:true,subtype:'error_max_turns',result:'Reached max turns (2)',modelUsage:{fixture:{contextWindow:73728}}},code:'RUNTIME_TURN_LIMIT'},
  {row:{is_error:true,result:'Prompt is too long: context_length_exceeded',modelUsage:{fixture:{contextWindow:73728}}},code:'CONTEXT_WINDOW_EXCEEDED'}
 ];
 for(const {row,code,status,exit=1}of cases){
  fs.writeFileSync(path.join(dir,'fixture-cli'),'#!/usr/bin/env node\nprocess.stdout.write('+JSON.stringify(JSON.stringify(row))+');process.exit('+exit+');',{mode:0o755});
  await assert.rejects(()=>local.requestModel({provider:{runtimeId:'custom-claude',model:'fixture-model'},messages:[]}),e=>{
   assert.equal(e.code,code);assert.equal(e.diagnostics.httpStatus,status);assert.equal(e.diagnostics.runtimeSubtype,row.subtype);assert.equal(!!e.diagnostics.contextExceeded,code==='CONTEXT_WINDOW_EXCEEDED');return true;
  });
 }
});


test('Claude transport honors host output budget and sends one tool catalog without duplicate response schemas',async t=>{
 const dir=fixture(t);const source=process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS='32000';t.after(()=>{if(source===undefined)delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;else process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS=source;});
 fs.writeFileSync(path.join(dir,'fixture-cli'),`#!/usr/bin/env node
 const fs=require('node:fs'),p=JSON.parse(fs.readFileSync(0,'utf8'));
 if(p.responseSchema||p.tools[0].parameters.properties.revision.type!=='string'||process.argv.includes('--json-schema'))process.exit(9);
 console.log(JSON.stringify({is_error:false,result:JSON.stringify({text:process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,calls:[]})}));`,{mode:0o755});
 const tools=[{name:'read_revision',parameters:{type:'object',properties:{revision:{type:'string'}}}}];
 const v=await local.requestModel({provider:{runtimeId:'custom-claude',model:'fixture',maxOutputTokens:8192},maxTokens:2048,messages:[],tools});
 assert.equal(v.content,'2048');assert.equal(process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,'32000');
 const v2=await local.requestModel({provider:{runtimeId:'custom-claude',model:'fixture',maxOutputTokens:8192},messages:[],tools});assert.equal(v2.content,'8192');
});
test('Claude transport avoids the native schema formatter and dispatches a host call once',async t=>{
 const dir=fixture(t),record=path.join(dir,'calls.jsonl');fs.writeFileSync(path.join(dir,'fixture-cli'),`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2),p=JSON.parse(fs.readFileSync(0,'utf8'));fs.appendFileSync(${JSON.stringify(record)},'x');if(a.includes('--json-schema')){console.log(JSON.stringify({is_error:true,subtype:'error_max_turns'}));process.exit(1);}if(a[a.indexOf('--max-turns')+1]!=='2'||a[a.indexOf('--tools')+1]!==''||!a.includes('--strict-mcp-config'))process.exit(8);console.log(JSON.stringify({is_error:false,result:JSON.stringify({text:'',calls:[{name:'read_fixture',arguments:{path:'actual.json'}}]})}));
`,{mode:0o755});
 const r=await local.requestModel({provider:{runtimeId:'custom-claude',model:'fixture-model'},messages:[{role:'user',content:'read actual.json'}],tools:[{name:'read_fixture',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}]});assert.equal(fs.readFileSync(record,'utf8'),'x');assert.equal(r.tool_calls.length,1);assert.equal(r.tool_calls[0].function.name,'read_fixture');
});
test('quota failure never causes model-only recovery',async t=>{const dir=fixture(t),record=path.join(dir,'quota-calls');fs.writeFileSync(path.join(dir,'fixture-cli'),`#!/usr/bin/env node
const fs=require('fs');fs.appendFileSync(${JSON.stringify(record)},'x');console.log(JSON.stringify({is_error:true,subtype:'error_max_turns',api_error_status:429}));process.exit(1);
`,{mode:0o755});await assert.rejects(()=>local.requestModel({provider:{runtimeId:'custom-claude',model:'fixture-model'},messages:[]}),e=>e.diagnostics.httpStatus===429);assert.equal(fs.readFileSync(record,'utf8'),'x');});

test('Codex failed turn preserves the actual error instead of only other',async t=>{const dir=fixture(t),file=path.join(dir,'codex');fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace("turn:{status:'completed'}","turn:{status:'failed',error:{codexErrorInfo:'other',message:'fixture transport disconnected',additionalDetails:'fixture diagnostic'}}"));await assert.rejects(local.requestModel({provider:{runtimeId:'codex',model:'fixture-model'},messages:[{role:'user',content:'read only'}]}),e=>e.code==='RUNTIME_TURN_FAILED'&&e.message==='fixture transport disconnected'&&e.diagnostics.additionalDetails==='fixture diagnostic');});

test('malformed arguments use existing single format correction without dispatching sibling calls',async t=>{
 const dir=fixture(t),record=path.join(dir,'format-calls');fs.writeFileSync(path.join(dir,'fixture-cli'),`#!/usr/bin/env node
const fs=require('fs'),p=JSON.parse(fs.readFileSync(0,'utf8'));fs.appendFileSync(${JSON.stringify(record)},'x');console.log(JSON.stringify({is_error:false,result:JSON.stringify({text:'',calls:p.formatCorrection?[{name:'read_fixture',arguments:'{}'}]:[{name:'read_fixture',arguments:'{}'},{name:'read_fixture',arguments:'broken'}]})}));`,{mode:0o755});
 const r=await local.requestModel({provider:{runtimeId:'custom-claude',model:'fixture'},messages:[{role:'user',content:'read'}],tools:[{name:'read_fixture'}]});assert.equal(fs.readFileSync(record,'utf8'),'xx');assert.equal(r.tool_calls.length,1);assert.equal(r.runtimeDiagnostics.mode,'structured-format-correction');
});
test('persistent invalid arguments stop after the single correction',async t=>{
 const dir=fixture(t),record=path.join(dir,'bad-calls');fs.writeFileSync(path.join(dir,'fixture-cli'),`#!/usr/bin/env node
const fs=require('fs');fs.readFileSync(0,'utf8');fs.appendFileSync(${JSON.stringify(record)},'x');console.log(JSON.stringify({is_error:false,result:JSON.stringify({text:'',calls:[{name:'read_fixture',arguments:'broken'}]})}));`,{mode:0o755});
 await assert.rejects(()=>local.requestModel({provider:{runtimeId:'custom-claude',model:'fixture'},messages:[],tools:[{name:'read_fixture'}]}),e=>e.code==='RUNTIME_ARGUMENTS_INVALID');assert.equal(fs.readFileSync(record,'utf8'),'xx');
});
test('Codex image protocol sends actual localImage inputs with owning-message labels',async t=>{
 const dir=fixture(t),file=path.join(dir,'image.png');fs.writeFileSync(file,'fixture protocol only');const cli=path.join(dir,'codex');let code=fs.readFileSync(cli,'utf8');code=code.replace("const prompt=JSON.parse(v.params.input[0].text);","if(v.params.input[2]?.type!=='localImage'||v.params.input[2]?.path!=="+JSON.stringify(file)+"||!v.params.input[1].text.includes('message 2'))process.exit(10);const prompt=JSON.parse(v.params.input[0].text);");fs.writeFileSync(cli,code,{mode:0o755});const r=await local.requestModel({provider:{runtimeId:'codex',model:'fixture-model'},messages:[{role:'user',content:'inspect'}],images:[{path:file,messageIndex:2,blockIndex:0}]});assert.match(r.content,/checked/);
 await assert.rejects(()=>local.requestModel({provider:{runtimeId:'claude',model:'fixture'},messages:[],images:[{path:file}]}),e=>e.code==='UNSUPPORTED_IMAGE_INPUT');
});


test('runtime turn limit has a specific user-visible label and safe protocol subtype',async()=>{
 const {failureView}=await import('../electron/agent/model-failure.mjs');
 const view=failureView(Object.assign(Error('raw CLI output must not leak'),{code:'RUNTIME_TURN_LIMIT',diagnostics:{runtimeSubtype:'error_max_turns',stderr:'secret'}}));
 assert.match(view.message,/模型运行时达到轮次上限/);assert.equal(view.diagnostics.runtimeSubtype,'error_max_turns');assert.ok(!JSON.stringify(view).includes('secret'));
 assert.equal(failureView({diagnostics:{runtimeSubtype:'token=secret'}}).diagnostics,undefined);
});
