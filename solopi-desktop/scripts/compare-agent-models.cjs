// Run with the project's Electron binary so OS-encrypted credentials remain in-process.
// No window, application state writes, tool execution, or automatic request retries.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
app.setName('solopi-desktop');app.dock?.hide();
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const dataDir=value('--data-dir'),output=value('--output');
if(!args.includes('--data-dir')||!dataDir||!args.includes('--output')||!output){console.error('Usage: electron scripts/compare-agent-models.cjs --data-dir <directory> --output <new-report.json> [--input <messages.json>] [--pairs 1..5]');app.exit(1);}
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
app.whenReady().then(async()=>{
  const state=JSON.parse(fs.readFileSync(path.join(dataDir,'workflow-editor-state.json'),'utf8'));
  const providerId=args.includes('--provider-id')?value('--provider-id'):state.selectedLlmProviderId;
  const selected=state.llmProviders?.find(p=>p.id===providerId)||(args.includes('--provider-id')?undefined:state.llmProviders?.[0]);
  if(!selected)throw Error('No configured model');
  const modelName=args.includes('--model-name')?value('--model-name'):selected.model;
  if(typeof modelName!=='string'||!modelName||modelName.length>200)throw Error('Invalid model name');
  const provider={...selected,model:modelName,...require('../electron/secret-storage').revealSecrets({apiKey:selected.apiKey},safeStorage),requestPolicy:require('../electron/agent/request-policy').requestPolicy()};
  const tools=args.includes('--tools')?JSON.parse(fs.readFileSync(value('--tools'),'utf8')):[];
  const maxTokens=Number(args.includes('--max-tokens')?value('--max-tokens'):256);
  if(!Array.isArray(tools)||!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>32768)throw Error('Invalid tools or output budget');
  if(args.includes('--reasoning-effort')){if(!['low','high','max'].includes(value('--reasoning-effort')))throw Error('Invalid reasoning effort');provider.reasoningEffort=value('--reasoning-effort');}
  if(args.includes('--thinking')){if(!['default','enabled','disabled'].includes(value('--thinking')))throw Error('Invalid thinking setting');provider.thinking=value('--thinking');}
  const shapes=[];
  const model=async options=>{const response=await require('../electron/agent/model').requestModel({...options,allowArgumentFeedback:args.includes('--argument-shape-audit')});
    if(args.includes('--argument-shape-audit'))for(const c of response.tool_calls || []){let validJson=true,validation;try{JSON.parse(c.function.arguments);}catch(error){validJson=false;validation=require('../electron/agent/tool-validation').validationDiagnostic('json',c,error);};shapes.push({stream:options.stream,toolName:tools.some(t=>t.function.name===c.function.name)?c.function.name:'unknown',characters:c.function.arguments.length,validJson,...(!validJson?{validation}:{}),closingTail:c.function.arguments.match(/[}\]\s]+$/)?.[0].replace(/\s/g,'').slice(-20)});}
    return response;};
  const messages=args.includes('--input')?JSON.parse(fs.readFileSync(value('--input'),'utf8')):[{role:'user',content:'请用一句中文回答：你能正常响应吗？不要调用工具。'}];
  if(!Array.isArray(messages))throw Error('Input must be a messages array');
  const report=await require('../electron/agent/model-comparison').compareModels({provider,messages,tools,maxTokens},{pairs:Number(args.includes('--pairs')?value('--pairs'):3),signal:controller.signal,model,onUpdate:r=>console.log(JSON.stringify({status:r.status,completed:r.rows.length,last:r.rows.at(-1)}))});
  fs.writeFileSync(output,JSON.stringify({...report,...(args.includes('--argument-shape-audit')?{argumentShapes:shapes}:{}),inputKind:args.includes('--input')?'provided-messages':'short-baseline',createdAt:new Date().toISOString()},null,2),{mode:0o600,flag:'wx'});
  app.exit(report.status==='completed'?0:2);
}).catch(error=>{console.error(error.code || error.name, error.diagnostics ? JSON.stringify(error.diagnostics) : '无法读取模型配置或执行对照；未输出凭据');app.exit(1);});
