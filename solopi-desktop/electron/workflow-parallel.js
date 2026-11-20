// Parallelism is inferred from unconditional graph edges, not control nodes.
const fail = message => Object.assign(new Error(message), {code:'PARALLEL_CONFIGURATION_INVALID'});
const assertionKinds = new Set(['tts_assert','json_assert','llm_assert','mobile_ui_assert']);
const handle = edge => String(edge.sourceHandle ?? edge.handle ?? edge.condition ?? '').trim().toLowerCase();
function parallelPlans(steps, edges, components = {}, options = {}) {
  const nodes=new Map(steps.map(s=>[s.id,s])),outgoing=new Map(),incoming=new Map(),plans=new Map(),owned=new Set();
  for(const e of edges){outgoing.set(e.source,[...(outgoing.get(e.source)||[]),e]);incoming.set(e.target,[...(incoming.get(e.target)||[]),e]);}
  for(const node of steps)if(['parallel','join','log_state'].includes(node.type))throw fail('旧并行控制节点已撤回，请迁移为直接分叉连线和已有日志文本断言');
  for(const fork of steps){
    if(options.onlyForkId && fork.id!==options.onlyForkId)continue;
    if(fork.type==='if')continue; // IF keeps its explicit branch selection semantics.
    const links=(outgoing.get(fork.id)||[]).filter(e=>!handle(e)||handle(e)==='default');
    if(links.length<2)continue;
    const branches=links.map(e=>nodes.get(e.target));let join;
    for(const branch of branches){
      const kind=components[branch?.componentId]?.kind;
      if(!branch || branch.type!=='component' || !assertionKinds.has(kind))throw fail('并行分支必须是已有的只读断言节点');
      if(owned.has(branch.id)||(incoming.get(branch.id)||[]).length!==1)throw fail('并行断言必须只由本组起点进入');
      if(branch.config?.assertBlocking===false||branch.config?.assertBlocking==='false'||branch.continueOnError)throw fail('并行汇合要求全部断言真实通过');
      if(branch.config?.observationMode==='latest'&&kind!=='tts_assert')throw fail('持续检查最新值仅适用于已有日志文本提取断言');
      if(branch.config?.observationMode==='latest'&&Number(branch.postDelayMs||0)>0)throw fail('持续检查不能配置执行后延时');
      const next=outgoing.get(branch.id)||[];const target=nodes.get(next[0]?.target);
      if(next.length!==1||handle(next[0])&&handle(next[0])!=='default'||!target||target.id===fork.id||branches.includes(target)||join&&join.id!==target.id)throw fail('并行断言必须直接连接同一个后续节点');
      join=target;owned.add(branch.id);
    }
    if((incoming.get(join.id)||[]).length!==branches.length)throw fail('共同后继只能接收本组并行断言的连线');
    const timeouts=branches.map(b=>Number(b.timeoutMs||Number(components[b.componentId]?.timeoutSeconds||45)*1000));
    if(timeouts.some(n=>!Number.isFinite(n)||n<=0))throw fail('并行断言超时必须为正数');
    plans.set(fork.id,{fork,branches,join,timeoutMs:Math.max(...timeouts)});
  }
  for(const branch of steps)if(!options.onlyForkId&&branch.config?.observationMode==='latest'&&!owned.has(branch.id))throw fail('持续检查最新值须通过分叉和共同后继构成完整并行组');
  return plans;
}
// Read-only presentation uses the same structural validator as execution.
function parallelPresentation(steps, edges, components = {}) {
  const nodes={}, edgeHints={}, groups=[], branchIds=new Set();
  const add=(id,hint)=>{(nodes[id]||=[]).push(hint);};
  for(const fork of steps){
    const links=edges.filter(e=>e.source===fork.id&&['','default'].includes(handle(e)));
    if(fork.type==='if'||links.length<2)continue;
    const branches=links.map(e=>steps.find(s=>s.id===e.target)).filter(Boolean);
    branches.forEach(b=>branchIds.add(b.id));
    try{
      const plan=parallelPlans(steps,edges,components,{onlyForkId:fork.id}).get(fork.id);
      const count=plan.branches.length;
      const detail=`${count} 路断言并行；全部通过且持续模式的最新值仍满足条件时，才执行共同后继。`;
      add(fork.id,{status:'valid',label:`并行 ${count} 路`,detail});
      add(plan.join.id,{status:'valid',label:`&& ${count} 路全部满足后继续`,detail});
      plan.branches.forEach((branch,index)=>{
        add(branch.id,{status:'valid',label:`&& 分支 ${index+1}/${count}`,detail:branch.config?.observationMode==='latest'?'持续检查最新值，回退后继续等待。':'命中后保留通过结果，等待其余分支。'});
        for(const edge of edges.filter(e=>e.source===branch.id&&e.target===plan.join.id))edgeHints[edge.id]={status:'valid',label:`&& ${index+1}/${count}`,detail};
        const sourceEdge=links.find(e=>e.target===branch.id);if(sourceEdge)edgeHints[sourceEdge.id]={status:'valid',label:`并行 ${index+1}/${count}`,detail};
      });
      groups.push({source:fork.id,target:plan.join.id,status:'valid'});
    }catch(error){
      const detail=error.message;
      add(fork.id,{status:'invalid',label:'并行连线未完成 · 运行前需修正',detail});
      for(const branch of branches)add(branch.id,{status:'invalid',label:'并行配置需修正',detail});
      for(const edge of edges.filter(e=>links.includes(e)||branches.some(b=>b.id===e.source)))edgeHints[edge.id]={status:'invalid',label:'⚠ 并行配置需修正',detail};
      groups.push({source:fork.id,status:'invalid',detail});
    }
  }
  for(const step of steps)if(step.config?.observationMode==='latest'&&!branchIds.has(step.id))add(step.id,{status:'invalid',label:'持续模式缺少并行连线',detail:'请从同一动作分出至少两路断言，并连接到共同后继。'});
  return {nodes,edges:edgeHints,groups};
}
function decorateParallelEdges(edges,presentation,runtimeLabels={}) {
  return edges.map(edge=>{
    const hint=presentation.edges[edge.id],runtime=runtimeLabels[edge.id];
    if(!hint&&!runtime)return edge;
    const color=hint?.status==='invalid'?'#dc2626':hint?'#047857':'#2563eb';
    return {...edge,label:[hint?.label,runtime||edge.label].filter(Boolean).join(' · '),
      labelBgPadding:[6,3],labelBgBorderRadius:8,
      labelBgStyle:{fill:hint?.status==='invalid'?'#fff1f2':hint?'#ecfdf5':'#eff6ff',fillOpacity:0.98},
      labelStyle:{fill:color,fontSize:11,fontWeight:800},
      style:{...edge.style,stroke:color,strokeWidth:2,...(hint?.status==='invalid'?{strokeDasharray:'5 4'}:{})}};
  });
}

async function runParallelListeners({plan,watch,execute,signal,onProgress=()=>{},observe}){
  const controller=new AbortController(), states=new Map(), latched=new Map(), terminal=new Set(), cleanups=[], startedAt=new Date().toISOString();
  let done=false,scheduled=false,resolve,reject;
  const result=new Promise((a,b)=>{resolve=a;reject=b;});result.catch(()=>{});
  const snapshot=()=>Object.fromEntries(states);
  const finish=(error)=>{if(done)return;done=true;error?reject(error):resolve({states:snapshot(),latched:Object.fromEntries(latched),timeoutMs:plan.timeoutMs,timeoutBudgets:plan.timeoutBudgets});};
  const check=()=>{if(scheduled||done)return;scheduled=true;queueMicrotask(()=>{scheduled=false;if(done)return;
    if(plan.branches.every(b=>b.config?.observationMode==='latest'?states.get(b.id)?.ready:latched.has(b.id)))finish();
  });};
  const abort=()=>finish(Object.assign(new Error('并行监听已停止'),{code:'WORKFLOW_STOPPED'}));
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>finish(Object.assign(new Error('并行监听条件未同时满足'),{code:'ASSERTION_TIMEOUT',timeoutMs:plan.timeoutMs,diagnostics:{states:snapshot(),passedBranches:[...latched.keys()],timeoutBudgets:plan.timeoutBudgets}})),plan.timeoutMs);
  const tasks=[];
  try{
    if(signal?.aborted)abort();
    // Install all continuous listeners BEFORE starting one-shot assertions.
    for(const b of plan.branches.filter(b=>b.config?.observationMode==='latest')){

      onProgress(b,{status:'running',startedAt});
      const close=await watch(b,(line,sequence)=>{if(done)return;try{const observation=observe(b,line);if(observation===null)return;const {value,ready}=observation;const previous=states.get(b.id);if(previous&&sequence<=previous.sequence)return;states.set(b.id,{value,sequence,ready,line});check();}catch(e){finish(e);}},finish);
      cleanups.push(close);
    }
    for(const b of plan.branches.filter(b=>b.config?.observationMode!=='latest')){
      if(done)break;onProgress(b,{status:'running',startedAt});
      tasks.push(Promise.resolve().then(()=>execute(b,controller.signal)).then(output=>{
        if(done)return;if(output?.success===false || output?.meta?.assertion?.passed===false)throw Error('并行断言未通过');
        latched.set(b.id,output);terminal.add(b.id);onProgress(b,{status:'success',startedAt,endedAt:new Date().toISOString(),...output});check();
      }).catch(e=>{terminal.add(b.id);onProgress(b,{status:e.code==='WORKFLOW_STOPPED'?'stopped':'failed',startedAt,error:e.message,errorCode:e.code});finish(e);}));
    }
    check();const receipt=await result;
    for(const b of plan.branches.filter(b=>b.config?.observationMode==='latest')){terminal.add(b.id);onProgress(b,{status:'success',startedAt,endedAt:new Date().toISOString(),meta:{nodeOutput:receipt.states[b.id]}});}
    return receipt;
  }catch(error){
    for(const b of plan.branches.filter(b=>b.config?.observationMode==='latest'&&!terminal.has(b.id))){terminal.add(b.id);onProgress(b,{status:error.code==='WORKFLOW_STOPPED'?'stopped':'failed',startedAt,endedAt:new Date().toISOString(),error:error.message,errorCode:error.code,meta:{nodeOutput:states.get(b.id)}});}
    throw error;
  }finally{done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();for(const close of cleanups)close();await Promise.allSettled(tasks);}
}
module.exports={parallelPlans,runParallelListeners,parallelPresentation,decorateParallelEdges};
