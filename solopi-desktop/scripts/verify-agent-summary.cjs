// Read-only shadow verification of the first real summary batch. Never commits a checkpoint.
const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
app.setName('solopi-desktop');app.dock?.hide();
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
app.whenReady().then(async()=>{
  for(const flag of ['--data-dir','--session','--output'])if(!args.includes(flag))throw Error('Missing argument');
  const dir=value('--data-dir'),file=path.join(dir,'agent','sessions',value('--session')+'.json'),raw=fs.readFileSync(file),session=new(require('../electron/agent/store').AgentStore)(()=>path.dirname(file)).get(value('--session'));
  const state=JSON.parse(fs.readFileSync(path.join(dir,'workflow-editor-state.json'),'utf8')),selected=state.llmProviders?.find(p=>p.id===state.selectedLlmProviderId)||state.llmProviders?.[0];
  const provider={...selected,...require('../electron/secret-storage').revealSecrets({apiKey:selected.apiKey},safeStorage),requestPolicy:require('../electron/agent/request-policy').requestPolicy()};
  const tools=(await require('../electron/agent/tools').createTools({invoke:()=>{throw Error('No tool execution');},readState:()=>({}),skillsRoots:()=>[],config:()=>({}),mcp:{}})({})).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.schema}}));
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lw-summary-shadow-'));let first,metrics;
  try{
    await require('../electron/agent/context').prepareModelMessages(session,require('../electron/agent/runtime').SYSTEM,{provider,tools,store:new(require('../electron/agent/store').AgentStore)(()=>tmp),model:async options=>{first ||= options;throw Error('First batch captured; no model call yet');}}).catch(()=>{});
    if(!first)throw Error('No summary batch needed');
    if(args.includes('--effort'))first.provider={...first.provider,thinking:'enabled',reasoningEffort:value('--effort')};
    const result=await require('../electron/agent/model').requestModel({...first,retry:false,onMetrics:m=>{metrics=m;},onProgress:undefined,onRetry:undefined});
    const digest=b=>createHash('sha256').update(b).digest('hex');
    const report={model:provider.model,inputKind:'first-real-history-summary-batch',thinking:first.provider.thinking,reasoningEffort:first.provider.reasoningEffort,finishReason:result.finish_reason,outputCharacters:result.content?.length || 0,reasoningCharacters:result.reasoning_content?.length || 0,metrics,sourceUnchanged:digest(fs.readFileSync(file))===digest(raw),checkpointCommitted:false};
    fs.writeFileSync(value('--output'),JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});console.log(JSON.stringify(report));
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  app.exit(0);
}).catch(error=>{console.error(error.diagnostics?JSON.stringify(error.diagnostics):error.code || error.name);app.exit(1);});
