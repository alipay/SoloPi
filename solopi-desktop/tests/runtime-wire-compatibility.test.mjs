import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
const require=createRequire(import.meta.url),local=require('../electron/agent/local-runtime.cjs'),{createTools}=require('../electron/agent/tools');
const parameters={type:'object',properties:{refresh:{type:'boolean'},nested:{type:'object',properties:{optional:{type:'string'}},additionalProperties:false},values:{type:'object',additionalProperties:{type:['string','null']}},nullable:{type:['string','null']}},required:['values'],additionalProperties:false};
const args={values:{dynamic:'kept',explicit:null},nullable:null};
function strict(schema){if(schema.type==='object'){assert.equal(schema.additionalProperties,false);assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort())}for(const value of Object.values(schema)){if(Array.isArray(value))for(const x of value)if(x&&typeof x==='object')strict(x);else{}else if(value&&typeof value==='object')strict(value)}}
test('every Desktop tool, including optional refresh and dynamic schemas, has a strict portable envelope',async()=>{
 const tools=await createTools({readState:()=>({}),config:()=>({}),skillsRoots:()=>[],mcp:{},invoke:()=>assert.fail('no host execution')})({});
 assert.ok(tools.length>50);const input=tools.map(t=>({name:t.name,parameters:t.schema})),before=JSON.stringify(input),schema=local.responseSchema(input);strict(schema);assert.equal(JSON.stringify(input),before);assert.equal(schema.properties.calls.items.properties.arguments.type,'string');assert.equal(schema.properties.calls.items.properties.name.enum.length,tools.length);
});
for(const malformedFirst of [false,true])for(const runtimeId of ['codex','custom-codex','claude','custom-claude'])test((malformedFirst?'format recovery: ':'')+runtimeId+' keeps optional omission, nullable values, dynamic keys and original tool schemas',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'wire-'+runtimeId+'-')),previous=process.env.PATH,oldConfig=process.env.SOLOPI_RUNTIME_CONFIG;process.env.SOLOPI_RUNTIME_CONFIG=join(dir,'runtime-definitions.json');require('../electron/agent/runtime-registry.cjs').save(dir,[{id:'custom-codex',name:'Fixture Codex',command:'fixture-cli',args:[],family:'codex'},{id:'custom-claude',name:'Fixture Claude',command:'fixture-cli',args:[],family:'claude'}]);process.env.PATH=dir+delimiter+previous;t.after(()=>{process.env.PATH=previous;if(oldConfig===undefined)delete process.env.SOLOPI_RUNTIME_CONFIG;else process.env.SOLOPI_RUNTIME_CONFIG=oldConfig;rmSync(dir,{recursive:true,force:true})});
 const record=join(dir,'record.json'),encoded=JSON.stringify(args);
 const code=`#!/usr/bin/env node
const fs=require('node:fs'),rl=require('node:readline'),argv=process.argv;
if(argv.includes('login'))process.exit(0);
const output=${malformedFirst}?{calls:[{name:'check_fixture',arguments:${JSON.stringify(encoded)}}],text:'fixture'}:{text:'fixture',calls:[{name:'check_fixture',arguments:${JSON.stringify(encoded)}}]};
let count=0;try{count=JSON.parse(fs.readFileSync(${JSON.stringify(record)},'utf8')).count||0;}catch{};const save=(prompt,schema)=>{count++;fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({prompt,schema,argv,count}));};const reply=()=>${malformedFirst}&&count===1?{calls:[{tool:'check_fixture',arguments:'{}'}]}:output;
if(${JSON.stringify(['codex','custom-codex'].includes(runtimeId))}){rl.createInterface({input:process.stdin}).on('line',line=>{const v=JSON.parse(line);if(v.id===undefined)return;let result={};if(v.method==='config/read')result={config:{}};if(v.method==='thread/start')result={thread:{id:'fixture'}};console.log(JSON.stringify({id:v.id,result}));if(v.method==='turn/start'){save(JSON.parse(v.params.input[0].text),v.params.outputSchema);console.log(JSON.stringify({method:'item/agentMessage/delta',params:{itemId:'final',delta:JSON.stringify(reply())}}));console.log(JSON.stringify({method:'item/completed',params:{item:{type:'reasoning',summary:['Provider summary'],content:['private raw content must not be surfaced']}}}));console.log(JSON.stringify({method:'item/completed',params:{item:{type:'agentMessage',phase:'commentary',text:'Visible progress'}}}));console.log(JSON.stringify({method:'item/completed',params:{item:{type:'agentMessage',text:JSON.stringify(reply())}}}));console.log(JSON.stringify({method:'turn/completed',params:{turn:{status:'completed'}}}));}})}else{let p='';process.stdin.on('data',b=>p+=b);process.stdin.on('end',()=>{if(argv.includes('--json-schema'))process.exit(9);save(JSON.parse(p));console.log(JSON.stringify({is_error:false,result:JSON.stringify(reply())}));})}
`;
 for(const name of ['codex','claude','fixture-cli'])writeFileSync(join(dir,name),code,{mode:0o755});
 const progress=[],responseProgress=[];const reply=await local.requestModel({onProgress:c=>progress.push(c),onResponseProgress:p=>responseProgress.push(p),provider:{runtimeId,model:'fixture-model'},messages:[{role:'user',content:'fixture only'}],tools:[{name:'check_fixture',parameters}]});
 if(['codex','custom-codex'].includes(runtimeId)){if(!malformedFirst)assert.ok(progress.some(c=>c.type==='text-delta'&&c.text==='fixture'));assert.ok(responseProgress.some(p=>p.characters>0));assert.ok(responseProgress.every(p=>!p.text));assert.ok(!JSON.stringify(progress).includes('dynamic'));assert.equal(reply.content,'Visible progress\n\nfixture');assert.equal(reply.reasoning_content,'Provider summary');assert.ok(!JSON.stringify(reply).includes('private raw content'));}assert.deepEqual(JSON.parse(reply.tool_calls[0].function.arguments),args);assert.equal(Object.hasOwn(JSON.parse(reply.tool_calls[0].function.arguments),'refresh'),false);const seen=JSON.parse(readFileSync(record,'utf8'));assert.equal(seen.count,malformedFirst?2:1);if(malformedFirst)assert.equal(reply.runtimeDiagnostics.mode,'structured-format-correction');if(['codex','custom-codex'].includes(runtimeId))strict(seen.schema);else assert.equal(Object.hasOwn(seen,'schema'),false);assert.deepEqual(seen.prompt.tools[0].parameters,parameters);assert.match(seen.prompt.instructions,/JSON-encoded STRING/);assert.match(seen.prompt.instructions,/user-visible progress/);assert.ok(!seen.prompt.instructions.includes('{"text":"","calls":['));
 if(['claude','custom-claude'].includes(runtimeId)){assert.equal(seen.argv[seen.argv.indexOf('--tools')+1],'');assert.ok(seen.argv.includes('--strict-mcp-config'));assert.ok(!seen.argv.includes('--json-schema'));assert.equal(seen.argv[seen.argv.indexOf('--max-turns')+1],'2');assert.deepEqual(JSON.parse(seen.argv[seen.argv.indexOf('--mcp-config')+1]),{mcpServers:{}});assert.deepEqual(seen.prompt.messages,[{role:'user',content:'fixture only'}]);if(malformedFirst)assert.equal(seen.prompt.formatCorrection.code,'RUNTIME_RESPONSE_INVALID')}
});

test('CLI waits for a slow successful runtime test while ordinary settings retain their bounded wait',async()=>{
 const source=readFileSync(new URL('../scripts/glassbox-cli.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function requestServiceControlForCli('),source.indexOf('\nasync function run(argv)',source.indexOf('async function requestServiceControlForCli(')));
 async function check(action){let clock=0;const ack={success:true,content:'OK'},fs={mkdirSync(){},mkdtempSync(){return '/fixture';},chmodSync(){},writeFileSync(){},existsSync(){return clock>=31000;},readFileSync(){return JSON.stringify(ack);},rmSync(){}};
  const call=new Function('fs','path','getHeadlessElectronLaunchForCli','getGlassBoxCliDataDir','spawn','createHeadlessElectronEnvForCli','sleep','Date',body+';return requestServiceControlForCli;')(fs,require('node:path'),()=>({command:'fixture',argsPrefix:[]}),()=>'/fixture',()=>({on(){},unref(){}}),()=>({}),async ms=>{clock+=ms;},{now:()=>clock});
  return{result:await call({action:'settings',operation:'runtime',runtime:{action}}),elapsed:clock};
 }
 const slow=await check('test');assert.equal(slow.result.success,true);assert.equal(slow.elapsed,31000);
 const quick=await check('get');assert.equal(quick.result.errorCode,'SERVICE_ACK_TIMEOUT');assert.equal(quick.elapsed,30000);
});

test('visible text prefix decodes incomplete JSON safely and never displays tool parameters',()=>{
 for(const value of ['你好\n世界','quoted "hi" and slash \\','emoji 😀']){
  const raw=JSON.stringify({text:value,calls:[{name:'fixture',arguments:'sensitive-tool-value'}]});
  assert.equal(local.visibleTextPrefix(raw),value);
  for(let i=0;i<raw.length;i++){const prefix=local.visibleTextPrefix(raw.slice(0,i));assert.ok(value.startsWith(prefix));assert.ok(!prefix.includes('sensitive-tool-value'));}
 }
 assert.equal(local.visibleTextPrefix('{"calls":[{"arguments":"private"}],"text":"later"}'),'');
});
