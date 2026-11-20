// Run with Electron; uses existing credential backend in memory. All exposed tools are fixtures.
const {app,safeStorage}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');
const project=path.resolve(__dirname,'..');
const option=name=>process.argv[process.argv.indexOf(name)+1];
if(!process.argv.includes('--data-dir')||!process.argv.includes('--out'))throw Error('Required: --data-dir <desktop data directory> --out <isolated output directory>');
const output=path.resolve(option('--out'));fs.mkdirSync(output,{recursive:true,mode:0o700});
const identity=require(path.join(project,'electron/product-identity'));
app.setName(process.platform==='darwin'?identity.KEYCHAIN_APP_NAME:identity.PRODUCT_NAME);
app.setPath('userData',path.join(output,'electron-profile'));app.dock?.hide();
app.whenReady().then(async()=>{
 const data=path.resolve(option('--data-dir'));
 const state=JSON.parse(fs.readFileSync(path.join(data,'workflow-editor-state.json')));
 const saved=state.llmProviders.find(p=>p.id===state.selectedLlmProviderId);
 const storage=require(path.join(project,'electron/credential-storage')).createCredentialStorage({directory:data,osStorage:safeStorage});
 const provider={...saved,...require(path.join(project,'electron/secret-storage')).revealSecrets({apiKey:saved.apiKey},storage),maxOutputTokens:16384,contextWindowTokens:262144};
 const {HarnessRuntime}=require(path.join(project,'electron/agent/harness-runtime'));
 const {AgentRuntime}=require(path.join(project,'electron/agent/runtime'));
 const {AgentStore}=require(path.join(project,'electron/agent/store'));
 const schema={type:'object',properties:{},additionalProperties:false};
 const rows=[];
 const scenarios=[
  {name:'case-identity-timezone',prompt:'只读核查任务task-fixture的#17「三要素为1-换个时间进场次选择」，解释为何UI失败但对照信息成功。必须先读取报告，以原始caseOrdinal/caseId/完整名称区分目标和对照，用Asia/Shanghai时间回答，不能把对照例当目标。',tools:[{name:'read_task_report',description:'读取task-fixture报告，时间带Z为UTC。',schema,execute:async()=>({taskId:'task-fixture',cases:[{caseOrdinal:17,caseId:'id17',name:'三要素为1-换个时间进场次选择',status:'failed',startedAt:'2026-10-22T16:41:29.989Z',endedAt:'2026-10-22T16:42:43.173Z',error:'等待JSON日志断言超时；最近未通过原因：字段type不一致，期望MovieShowtimes，实际OrderPreview',assertionSource:'glasses-log-json',screenshotInspected:false},{caseOrdinal:30,caseId:'id30',name:'三要素为1-换个时间进场次选择_退出',status:'success',startedAt:'2026-10-22T16:55:48.229Z',endedAt:'2026-10-22T16:56:34.273Z'}]})}],grade:s=>{const answer=s.messages.findLast(m=>m.role==='assistant')?.content||'';return /17/.test(answer)&&/失败|failed/i.test(answer)&&/30/.test(answer)&&/00:41/.test(answer)&&/00:55/.test(answer);}},
  {name:'read-existing-receipt',prompt:'receipt-fixture是已有成功操作。只调用read_fixture_receipt核对并告诉我它已完成，不要重新提交，也不需要另造工作计划。',tools:[{name:'read_fixture_receipt',description:'只读已有成功操作，不会执行写操作',schema,execute:async()=>({success:true,operationId:'receipt-fixture',status:'completed',businessOutcomeVerified:true})}],grade:s=>s.calls.some(c=>c.name==='read_fixture_receipt'&&c.status==='done')&&s.status==='idle'},
  {name:'ordinary-command-with-stale-skill',prompt:'调用read_fixture_command只读模拟命令结果，告诉我当前状态。不需要其他Skill或工作计划，不执行真实命令。',tools:[{name:'read_fixture_command',description:'读取模拟命令结果，普通工具无Skill依赖',schema,execute:async()=>({success:true,stdout:'READY',exitCode:0})}],grade:s=>s.calls.some(c=>c.name==='read_fixture_command'&&c.status==='done')&&s.status==='idle'}
 ];
 if(process.argv.includes('--historical'))scenarios.push(...require('./fixtures/harness-history-glm.cjs')());
 if(process.argv.includes('--submission-contracts'))scenarios.push(...await require('./fixtures/harness-submission-glm.cjs')());
 const selected=process.argv.includes('--scenario')?scenarios.filter(s=>s.name===option('--scenario')):scenarios;
 if(!selected.length)throw Error('No matching isolated scenario');
 for(const scenario of selected)for(const engine of ['legacy','official']){
   scenario.reset?.();
   const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-glm-isolation-'));const store=new AgentStore(()=>dir);const s=store.create();s.approvalMode='auto';
   if(scenario.name.includes('stale'))s.skillUpdates={unrelated:{name:'missing-old-skill',success:false}};
   store.save(s);const Runtime=engine==='legacy'?AgentRuntime:HarnessRuntime;
   const runtime=new Runtime({store,tools:async()=>scenario.tools.map(t=>({...t})),provider:async()=>provider,emit:()=>{}});
   const begin=Date.now();let error;const stop=setTimeout(()=>runtime.stop(s.id),180000);
   try{await runtime.start(s.id,scenario.prompt,{});if(engine==='official')await runtime.hosts.get(s.id).idle();else while(runtime.active.has(s.id))await new Promise(r=>setTimeout(r,100));}catch(e){error=e.message;}
   clearTimeout(stop);await new Promise(r=>setImmediate(r));const result=runtime.liveSessions.get(s.id)||store.get(s.id);
   const row={scenario:scenario.name,engine,model:provider.model,durationMs:Date.now()-begin,status:result.status,pass:scenario.grade(result),toolCalls:result.calls.length,failedCalls:result.calls.filter(c=>c.status==='failed').length,modelRequests:result.messages.filter(m=>m.role==='assistant').length,error:error||result.error||null,answer:result.messages.findLast(m=>m.role==='assistant')?.content};rows.push(row);
   fs.writeFileSync(path.join(output,'glm-comparison.json'),JSON.stringify({isolated:true,realDeviceCalls:0,externalWrites:0,rows},null,2),{mode:0o600});console.log(JSON.stringify({...row,answer:undefined}));
   await runtime.stopAll();fs.rmSync(dir,{recursive:true,force:true});
 }
 app.exit(rows.filter(r=>r.engine==='official').every(r=>r.pass)?0:1);
}).catch(e=>{console.error(e.message);app.exit(1);});
