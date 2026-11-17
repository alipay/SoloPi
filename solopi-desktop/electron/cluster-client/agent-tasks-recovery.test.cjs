'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {AgentTasks}=require('./agent-tasks.cjs'),{createAgentExecutor}=require('./agent-executor.cjs'),{createTransport}=require('./transport.cjs');
const clientId='01M6JVA2KF08T0VZ0ZZABRAQFJ',agentTaskId='01M6QHK9V6X4PW4F7C95EGMCMD';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-network-recovery-'));let drop=false,reports=0;const reportBodies=[];
 const task={agentTaskId,clientId,kind:'tool-call',tool:{name:'list_devices',args:{}},prompt:null,status:'delivered',expiresAt:new Date(Date.now()+60000).toISOString()};
 const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):null;let result;
  if(req.url.startsWith('/v1/events?'))result={events:[],snapshotSeq:0,hasMore:false};
  else if(req.url.startsWith('/v1/agent-tasks/queue?'))result={items:task.status==='succeeded'?[]:[task],nextSinceId:1,hasMore:false};
  else if(req.url.endsWith('/progress')){task.status='running';result={status:'running'};}
  else if(req.url.endsWith('/result')){reports++;reportBodies.push(body);task.status='succeeded';result={agentTaskId,status:'succeeded'};if(drop){drop=false;req.socket.destroy();return;}}
  else {res.writeHead(404);res.end();return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const counter=path.join(dir,'counter');
 function executor(){return createAgentExecutor({directory:path.join(dir,'native'),tools:async()=>[{name:'list_devices',schema:{type:'object',properties:{},additionalProperties:false},execute:async()=>{const n=fs.existsSync(counter)?Number(fs.readFileSync(counter)):0;fs.writeFileSync(counter,String(n+1));return {success:true,devices:[]};}}]});}
 function bridge(){const request=createTransport({serverUrl:url,allowInsecureHttp:true,apiMode:'v1'});const connector={state:{clientId},session:{sessionId:'isolated-session',epoch:1},call:request};return new AgentTasks({directory:path.join(dir,'map'),connector,executor:executor()});}
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,url,counter,task,reportBodies,bridge,get reports(){return reports},drop(){drop=true}};
}
test('HTTP response reset after result commit retries only durable report under renewed session',async t=>{
 const x=await fixture(t),a=x.bridge();await a.tick();await Promise.all([...a.active.values()].map(v=>v.promise));x.drop();await assert.rejects(a.tick(),{code:'NETWORK_FAILED'});assert.equal(x.task.status,'succeeded');assert.equal(a.state.records[agentTaskId].reported,undefined);
 const b=x.bridge();b.connector.session={sessionId:'renewed-isolated-session',epoch:2};await b.tick();assert.equal(fs.readFileSync(x.counter,'utf8'),'1');assert.equal(x.reports,2);assert.equal(x.reportBodies[1].epoch,2);assert.equal(b.state.records[agentTaskId].reported,true);await b.close();await a.close();
});
for(const afterReceipt of [true,false])test(`SIGKILL process recovery ${afterReceipt?'uses native receipt':'retains unknown with no receipt'} without replay`,async t=>{
 const x=await fixture(t);const script=`const fs=require('node:fs'),path=require('node:path');const {AgentTasks}=require(${JSON.stringify(require.resolve('./agent-tasks.cjs'))});const {createAgentExecutor}=require(${JSON.stringify(require.resolve('./agent-executor.cjs'))});const {createTransport}=require(${JSON.stringify(require.resolve('./transport.cjs'))});const dir=process.argv[1],url=process.argv[2];const e=createAgentExecutor({directory:path.join(dir,'native'),tools:async()=>[{name:'list_devices',schema:{type:'object',properties:{},additionalProperties:false},execute:async()=>{fs.writeFileSync(path.join(dir,'counter'),'1');return {success:true,devices:[]}}}]});const run=e.execute.bind(e);e.execute=async(...args)=>{${afterReceipt?'await run(...args);':''}process.kill(process.pid,'SIGKILL')};const b=new AgentTasks({directory:path.join(dir,'map'),connector:{state:{clientId:${JSON.stringify(clientId)}},session:{sessionId:'isolated-session',epoch:1},call:createTransport({serverUrl:url,allowInsecureHttp:true,apiMode:'v1'})},executor:e});b.tick().catch(()=>process.exit(2));`;
 const child=spawn(process.execPath,['-e',script,x.dir,x.url],{stdio:'ignore'});const timer=setTimeout(()=>child.kill('SIGKILL'),5000);const [code,signal]=await once(child,'exit');clearTimeout(timer);assert.equal(signal,'SIGKILL');assert.equal(code,null);
 const before=JSON.parse(fs.readFileSync(path.join(x.dir,'map/tasks.json')));assert.equal(before.records[agentTaskId].phase,'dispatching');const requestId=before.records[agentTaskId].requestId;
 const b=x.bridge();await b.tick();await b.tick();assert.equal(b.state.records[agentTaskId].requestId,requestId);
 if(afterReceipt){assert.equal(fs.readFileSync(x.counter,'utf8'),'1');assert.equal(x.reports,1);assert.equal(b.state.records[agentTaskId].reported,true);}
 else {assert.equal(fs.existsSync(x.counter),false);assert.equal(x.reports,0);assert.equal(b.state.records[agentTaskId].phase,'unknown');}
 await b.close();
});
