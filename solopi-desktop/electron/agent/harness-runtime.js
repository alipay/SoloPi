// Desktop lifecycle and UI projection only. DeepSeek owns turns, steps and dispatch.
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {hostKey,HarnessHostCache}=require('./host-lifecycle');
const SYSTEM=`你是 SoloPi 桌面助手。使用工具返回的真实任务、用例身份和操作结果回答用户。报告时间带Z表示UTC，展示时间转换为用户时区。不同caseId是不同执行，不把对照例当成目标例。工具错误如实反馈并按工具schema修正；未知写操作结果先查证，不重复执行。Skill是按需读取的工作说明，不是调用普通工具的凭证。用户停止时立即停止当前助手工作。`;
class HarnessRuntime {
  constructor({store,tools,provider,emit=()=>{},adapter,model,cwd,skillCatalog,screen}) {
    Object.assign(this,{store,tools,provider,emit,adapter,model,cwd,skillCatalog,screen});
    this.experiences=new (require('./experience-memory').ExperienceMemory)(()=>store.directory());
    this.active=new Map();this.liveSessions=new Map();this.contexts=new Map();this.hosts=new Map();this.creating=new Map();this.approvals=new Map();this.events=new Map();this.cancelEpoch=new Map();this.closing=new Map();this.closed=false;this.hostCache=new HarnessHostCache({hosts:this.hosts,creating:this.creating});
    require('../diagnostics').record({event:'agent.runtime-loaded',runtimeRevision:'deepseek-harness/0.2.1-alpha.2'});
  }
  save(s){s.updatedAt=new Date().toISOString();this.store.sealHistory?.(s);this.store.save(s);this.emit(s);}
  async host(s,context){
    if(this.closing.has(s.id))await this.closing.get(s.id);
    if(this.active.has(s.id)&&this.hosts.has(s.id))return this.hosts.get(s.id);
    const provider=await this.provider();
    return this.hostCache.get(s.id,hostKey({provider,screenMode:s.screenMode||'main'}),()=>this.createHost(s,context,provider));
  }
  async createHost(s,context,selectedProvider){
    const {createHarnessHost,legacySeed,desktopMessage}=await import('./harness-host.mjs');
    const provider=selectedProvider||await this.provider();
    const built=(await this.tools(context,new AbortController().signal,s)).map(t=>({...t,description:t.description||t.name}));
    // Progress receipts and Skill epochs belonged to the retired orchestrator.
    const retired=new Set(['update_work_state','finish_work','discover_tools',...(this.skillCatalog?['list_skills','read_skill','read_skill_reference']:[])]);
    const tools=built.filter(t=>!retired.has(t.name));
    const submit=tools.find(t=>t.name==='submit_task');
    if(submit){const start=submit.description.indexOf('提交现有用例：');if(start>=0)submit.description=submit.description.slice(start);}
    for(const tool of tools.filter(t=>['run_command','run_commands'].includes(t.name))){
      tool.schema=structuredClone(tool.schema);
      tool.description=tool.description.replace(/Skill命令声明skillContext。?/g,'');
    }
    tools.push(require('./receipt-tools').operationReceiptTool({lookup:async callId=>{
      const exact=s.calls.find(c=>c.id===callId);return exact?[exact]:s.calls.filter(c=>c.modelCallId===callId);
    },project:async(c,pointers)=>{const id=this.store.saveEvidence(s.id,randomUUID(),c.result??null,{toolName:c.name});return this.store.projectEvidence(s.id,id,pointers);}}));
    tools.push({name:'read_context_record',description:'按evidenceId回读平台通知原记录，pointers为JSON Pointer字段路径；大字段返回完整projectionPath。不会执行原操作。',schema:{type:'object',properties:{evidenceId:{type:'string'},pointers:{type:'array',minItems:1,maxItems:20,items:{type:'string'}}},required:['evidenceId','pointers'],additionalProperties:false},readOnly:true,execute:async({evidenceId,pointers})=>this.store.projectEvidence(s.id,evidenceId,pointers)});
    tools.push(require('./receipt-tools').userMessagesTool({messages:()=>s.messages}));
    await require('./operation-receipts').hydrateLegacyReceipts(s,tools,()=>this.save(s));
    const operationTools=tools.map(t=>({...t,execute:(args,exec)=>{
      const ledger=s.calls.findLast(c=>c.modelCallId===exec.operationId);
      if(!ledger)throw Error('工具操作尚未记录，未执行');
      return require('./operation-receipts').executeOperation({session:s,save:()=>this.save(s),scope:s.messages.findLast(m=>m.role==='user'&&m.source!=='platform')?.harnessMessageId,tool:t,args,context:{...exec,operationId:ledger.id,modelCallId:exec.operationId}});
    }}));
    const persistenceDirectory=path.join(this.store.directory(),'harness');
    const historical=require('./context').modelMessages(s,'',undefined,{}).filter(m=>m.role!=='system');
    const knownIds=new Set(s.messages.map(m=>m.harnessMessageId).filter(Boolean));
    let hostError,lastStreamEmit=0,streamTimer;
    const failureTrace=new (require('./harness-request-recovery').RequestFailureTrace)();
    const emitStream=()=>{clearTimeout(streamTimer);streamTimer=undefined;lastStreamEmit=Date.now();if(!this.closed)this.emit(s);};
    const seed=legacySeed(historical);
    if(s.harnessProjectionSeq===undefined)s.harnessProjectionSeq=seed.length-1;
    const options={id:s.id,provider,tools:operationTools,system:()=>(s.screenMode==='virtual'?require('./virtual-system-prompt'):SYSTEM)+`\n用户时区：${Intl.DateTimeFormat().resolvedOptions().timeZone}\n执行审批模式：${s.approvalMode||'ask'}；模式不扩大用户授权，写操作由工具边界审批。参数被拒绝时请按schema修正完整参数；无法完成则明确说明未完成。`,adapter:this.adapter,model:this.model?(options=>this.model(options)):undefined,cwd:s.screenMode==='virtual'?undefined:this.cwd,skillCatalog:s.screenMode==='virtual'?undefined:this.skillCatalog,
      persistenceDirectory,seed,
      beforeTool:async exec=>{
        const tool=tools.find(t=>t.name===exec.name),ledger=s.calls.findLast(c=>c.modelCallId===exec.callId);
        if(!ledger)throw Error('工具操作尚未记录，未执行');
        if((tool?.confirm || ['write','edit'].includes(exec.name)) && s.approvalMode!=='auto'){
          s.status='awaiting_approval';this.save(s);
          const allow=await new Promise(resolve=>{
            const abort=()=>{this.approvals.delete(ledger.id);resolve(false);};
            exec.signal.addEventListener('abort',abort,{once:true});
            this.approvals.set(ledger.id,allow=>{exec.signal.removeEventListener('abort',abort);this.approvals.delete(ledger.id);resolve(allow);});
            if(exec.signal.aborted)abort();
          });
          if(!allow)throw Error('用户拒绝或停止了操作；未执行');
        }
        ledger.status='running';s.status='running';this.save(s);
      },
      onIncomplete:pending=>{s.error='存在参数无效且未执行的工具操作';s.errorDetails={code:'UNRESOLVED_TOOL_ARGUMENTS',pending};},
      onError:error=>{error=failureTrace.decorate(error);hostError=error;this.recordFailure(s,error);s.errorDetails={code:error.code||'UNKNOWN',category:error.code||'UNKNOWN',evidenceId:s.reviewFailures?.at(-1)?.evidenceId};s.error=error.message;s.status='failed';const delivery=require('./task-result-delivery').taskResultDelivery(s);if(delivery)s.messages.push(delivery);this.save(s);},
      onModel:record=>{
        failureTrace.model(record);
        require('../diagnostics').record({...record,sessionId:s.id,runtimeRevision:'deepseek-harness/0.2.1-alpha.2'});
        s.turnMetrics||={modelRequests:0,modelMs:0,preparationMs:0};
        if(record.event==='model.start'&&record.purpose==='conversation')s.turnMetrics.modelRequests++;
        if(record.event==='model.start'&&record.purpose==='compaction'){
          s.contextState={...s.contextState,phase:'compacting',startedAt:s.contextState?.phase==='compacting'?s.contextState.startedAt:Date.now(),batchStartedAt:Date.now(),outputCharacters:0,reasoningCharacters:0,currentChunk:s.contextState?.phase==='compacting'?s.contextState.currentChunk||1:1,totalChunks:s.contextState?.phase==='compacting'?s.contextState.totalChunks||1:1};this.emit(s);
        }
        if(record.event==='context.summary-progress'){
          s.contextState={...s.contextState,phase:'compacting',currentChunk:record.currentChunk,totalChunks:record.totalChunks};this.emit(s);
        }
        if(record.event==='context.summary-output'){s.contextState={...s.contextState,outputCharacters:record.outputCharacters,reasoningCharacters:record.reasoningCharacters};this.emit(s);}
        if(record.event==='context.compaction'){
          s.contextState={...s.contextState,phase:record.outcome==='failed'?'failed':'ready'};this.emit(s);
        }

        if(record.event==='model.response'){const key=record.purpose==='conversation'?'modelMs':'preparationMs';s.turnMetrics[key]=(s.turnMetrics[key]||0)+record.durationMs;}
      },
      onStream:({frame})=>{
        const firstVisible=frame.type==='chunk'&&((frame.chunk.type==='text-delta'&&!s.streaming?.content)||(frame.chunk.type==='reasoning-delta'&&!s.streaming?.reasoning));
        s.streaming=require('./stream-projection').reduce(s.streaming,frame);
        if(frame.type!=='chunk'||firstVisible||Date.now()-lastStreamEmit>=100)emitStream();else if(!streamTimer)streamTimer=setTimeout(emitStream,100-(Date.now()-lastStreamEmit));
      },
      onEvent:event=>{
        if(event.seq<=s.harnessProjectionSeq)return;
        const now=new Date(event.time).toISOString();const d=event.data;
        failureTrace.event(event);
        if(event.type==='turn/start')hostError=undefined;
        if(event.type==='llm/retry'){
          s.retry={attempt:d.retry,maxAttempts:d.maxRetries,retryAt:event.time+d.delayMs,phase:'backoff',reason:d.failure?.code || 'UNKNOWN'};
          this.emit(s);
        }
        if(event.type==='llm/retry-started'){
          if(s.retry)s.retry={...s.retry,phase:'requesting',retryAt:0};
          this.emit(s);
        }
        if(event.type==='assistant/message')delete s.retry;
        if(event.type==='turn/start'){s.error='';delete s.errorDetails;s.status='running';s.turnMetrics={startedAt:Date.now(),modelRequests:0,toolCalls:0};}
        if(['user/message','assistant/message'].includes(event.type)){
          const m=event.type==='user/message'?d:d.message;
          const visible=event.type==='assistant/message'||['user','solopi-platform'].includes(m.source.kind);
          if(visible&&!knownIds.has(m.id)&&!s.messages.some(existing=>existing.harnessMessageId===m.id)){s.messages.push({...desktopMessage(m),...(m.source.desktopAttachments?{attachments:m.source.desktopAttachments}:{}),source:event.type==='user/message'?(m.source.kind==='user'?'user':'platform'):undefined,createdAt:now});knownIds.add(m.id);}
          if(event.type==='user/message'&&m.source.kind==='user')require('./experience-memory').beginScope(s);
          if(event.type==='user/message')s.queuedMessages=(s.queuedMessages||[]).filter(q=>q.harnessMessageId!==m.id);
        }
        if(event.type==='tool/call'){
          let args;try{args=JSON.parse(d.arguments);}catch{args={rawArguments:d.arguments};}
          s.calls.push({id:randomUUID(),modelCallId:d.callId,name:d.name,args,status:'pending',createdAt:now,executor:'deepseek-harness'});
          s.turnMetrics.toolCalls++;
        }
        if(event.type==='tool/result'&&event.surfaceOp?.op!=='replace'){
          const m=d.message;let result;try{result=JSON.parse(desktopMessage(m).content);}catch{result={success:!m.isError,content:desktopMessage(m).content};}
          const c=s.calls.findLast(c=>c.modelCallId===m.toolCallId);
          if(c){c.result=result;c.status=require('./tool-outcome').status(result,m.isError);c.finishedAt=now;}
          s.messages.push({...desktopMessage(m),createdAt:now});
          if(result?.waiting){s.watch=result.waiting;if(result.waiting.reviewCases){s.reviewWatch=s.watch;}this.parkInbox(s,this.hosts.get(s.id),'watch');}
        }
        if(event.type==='turn/end'){
          const reason=d.reason;
          if(reason?.kind==='error'){s.status='failed';s.error=hostError?.message||reason.error?.message||'Harness请求失败';}
          else if(['aborted','interrupted','blocked','max-tokens'].includes(reason?.kind)){s.status='interrupted';}
          else if(s.status!=='failed')s.status=s.watch?'waiting':'idle';
          if(['aborted','interrupted'].includes(reason?.kind)&&s.currentReview&&s.watch)this.recordFailure(s,Object.assign(Error('分析被中断，未完成'),{code:'INTERRUPTED'}));
          delete s.currentReview;delete s.retry;if(reason?.kind!=='error'||s.streaming?.stage!=='incomplete')delete s.streaming;
        }
        s.executor={name:'deepseek-harness',version:'0.2.1-alpha.2'};s.harnessProjectionSeq=event.seq;
        // Native JSONL owns every event. Persist the desktop projection only
        // when visible content/state changes, not for every loop bookkeeping row.
        if(['user/message','assistant/message','tool/call','tool/result','turn/start','turn/end'].includes(event.type))this.save(s);
      }};
    const h=await createHarnessHost(options);if(this.closed){await h.dispose();return h;}
    // JSONL is authoritative. Repair a UI projection interrupted after durable
    // commit, without asking the model or replaying any operation.
    for(let seq=s.harnessProjectionSeq+1;seq<h.agent.session.seq;seq++)options.onEvent(h.agent.session.eventAt(seq));
    const dispose=h.dispose;h.dispose=async()=>{clearTimeout(streamTimer);await dispose();clearTimeout(streamTimer);};
    h.provider=provider;h.screenMode=s.screenMode||'main';h.experienceRevision=require('./experience-memory').version(tools,'deepseek-harness/0.2.1-alpha.2');this.hosts.set(s.id,h);return h;
  }
  async start(id,text,context,attachments=[]){
    if(this.closed)throw Error('助手已关闭');
    if(typeof text!=='string'||!text.trim())throw Error('请输入消息');
    const epoch=this.cancelEpoch.get(id)||0;
    const s=this.liveSessions.get(id)||this.store.get(id);this.liveSessions.set(id,s);this.contexts.set(id,context);
    if(!this.active.has(id)&&this.screen){
      if(s.screenCleanup?.confirmed===false)throw Error('副屏清理尚未确认，请先重试清理');
      if(s.screenReport?.recoveryRecordRemovalFailed)throw Error('恢复记录尚未删除，请先重试删除');
      const setting=this.screen.settings();s.screenMode=setting.screenMode;
      if(s.screenMode==='virtual'){const device=this.screen.device();s.screenDevice={serial:device?.serial||'',runtime:device?.runtime||''};s.screenChecks=structuredClone(setting.virtualChecks);s.screenCleanup={confirmed:false,ownerActive:true};delete s.screenReport;}
      else {delete s.screenCleanup;delete s.screenDevice;}this.save(s);
    }
    const h=await this.host(s,context).catch(async error=>{await this.finishScreen(s);throw error;});if(this.closed||epoch!==(this.cancelEpoch.get(id)||0))return s;s.error='';delete s.errorDetails;
    const steering=this.active.has(id);if(steering)h.agent.cancel({kind:'user'},{keepInbox:true});
    const target=steering?'next-step':'next-turn';
    if(s.lastInterruption){s.lastInterruption.resumedAt=new Date().toISOString();const {userInput}=await import('./harness-host.mjs');h.agent.inject(userInput(JSON.stringify({lastInterruption:s.lastInterruption}),'context'));}
    const content=text+(attachments.length?'\n附件（资料）:\n'+attachments.map(a=>`${a.name}: ${a.path}`).join('\n'):'');
    if(s.title==='新对话')s.title=text.slice(0,36);
    const frame=await this.experiences.frame(text,h.experienceRevision);if(frame){const {userInput}=await import('./harness-host.mjs');h.agent.inject(userInput(frame,'context'));}
    const input=await h.input(content,attachments);if(this.closed||epoch!==(this.cancelEpoch.get(id)||0))return s;const {desktopMessage}=await import('./harness-host.mjs');s.messages.push({...desktopMessage(input),...(input.source?.desktopAttachments?{attachments:input.source.desktopAttachments}:{}),source:'user',createdAt:new Date().toISOString()});s.status='running';s.turnMetrics={startedAt:Date.now(),modelRequests:0,toolCalls:0};this.save(s);h.agent.send(input,target,true);this.observeIdle(s,h);return s;
  }
  observeIdle(s,h){
    if(this.active.has(s.id))return;
    this.active.set(s.id,h);
    void h.idle().finally(async()=>{await this.finishScreen(s);this.active.delete(s.id);this.syncQueue(s,h);this.releaseWatchQueue(s,h);this.experiences.capture(s,h.experienceRevision);if(s.watch&&['failed','interrupted'].includes(s.status))s.status='waiting';this.save(s);if(!this.closed)this.resume(s.id);});
  }
  syncQueue(s,h){
    const pending=new Set([...h.agent.inbox.nextTurn,...h.agent.inbox.nextStep].map(m=>m.id));
    s.queuedMessages=(s.queuedMessages||[]).filter(m=>m.editing||m.heldInput||pending.has(m.harnessMessageId));
  }
  async enqueue(id,text,attachments=[]){
    const s=this.liveSessions.get(id)||this.store.get(id);this.liveSessions.set(id,s);const context=this.contexts.get(id);
    if(!context)throw Error('请先打开对话');
    const h=await this.host(s,context);
    const m=await h.input(text+(attachments.length?'\n'+attachments.map(a=>a.path).join('\n'):''),attachments);
    (s.queuedMessages||=[]).push({id:m.id,harnessMessageId:m.id,rawText:text,content:text,attachments,createdAt:new Date().toISOString()});
    if(s.queuedMessages.some(q=>q.editing)||s.watch||['waiting','failed','interrupted','awaiting_approval'].includes(s.status)){const q=s.queuedMessages.at(-1);q.heldInput=structuredClone(m);if(s.watch)q.holdForWatch=true;else if(['failed','interrupted'].includes(s.status))q.paused=true;}else{h.agent.send(m,'next-turn',true);this.observeIdle(s,h);}this.save(s);return s;
  }
  editQueued(id,messageId,{text,editing}={}){
    const s=this.liveSessions.get(id)||this.store.get(id),h=this.hosts.get(id),m=s.queuedMessages?.find(m=>m.id===messageId);
    if(!m||!h)throw Error('消息已开始处理或不存在');
    if((text===undefined&&editing===undefined)||(text!==undefined&&(typeof text!=='string'||!text.trim()))||(editing!==undefined&&typeof editing!=='boolean'))throw Error('无效的消息编辑');
    if(editing===true&&!m.editing){
      const pending=[...h.agent.inbox.nextTurn,...h.agent.inbox.nextStep].find(p=>p.id===m.harnessMessageId);
      if(!pending&&!m.heldInput)throw Error('消息已开始处理');
      for(const q of s.queuedMessages.slice(s.queuedMessages.indexOf(m))){const input=[...h.agent.inbox.nextTurn,...h.agent.inbox.nextStep].find(p=>p.id===q.harnessMessageId);if(input){q.heldInput=structuredClone(input);h.agent.inbox.remove(input.id);}}
    }
    if(text!==undefined){if(!text.trim())throw Error('请输入消息');m.rawText=text;m.content=text;
      const pending=[...h.agent.inbox.nextTurn,...h.agent.inbox.nextStep].find(p=>p.id===m.harnessMessageId);
      if(m.heldInput)m.heldInput.content=[{type:'text',text}];
      else if(!pending||!h.agent.inbox.replace(pending.id,{...pending,content:[{type:'text',text}]}))throw Error('消息已开始处理');}
    m.editing=!!editing;if(editing===false)m.paused=false;
    if(!m.editing)this.releaseDraftQueue(s,h);
    this.save(s);return s;
  }
  releaseWatchQueue(s,h){if(!s.watch&&s.status==='idle'){for(const q of s.queuedMessages||[])q.holdForWatch=false;this.releaseDraftQueue(s,h);}}
  releaseDraftQueue(s,h){if(!h)return;for(const q of s.queuedMessages||[]){if(q.editing||q.paused||q.holdForWatch)break;if(q.heldInput){const input=q.heldInput;delete q.heldInput;h.agent.send(input,'next-turn',true);this.observeIdle(s,h);}}}
  deleteQueued(id,messageId){const s=this.liveSessions.get(id)||this.store.get(id);this.hosts.get(id)?.agent.inbox.remove(messageId);s.queuedMessages=(s.queuedMessages||[]).filter(m=>m.id!==messageId);const h=this.hosts.get(id);if(h)this.releaseDraftQueue(s,h);this.save(s);return s;}
  async steerQueued(id,messageId,context){const s=this.liveSessions.get(id)||this.store.get(id),m=s.queuedMessages?.find(m=>m.id===messageId);if(!m)return s;if(m.heldInput?.source?.kind&&m.heldInput.source.kind!=='user')throw Error('平台通知不能作为用户指令引导');this.deleteQueued(id,messageId);this.hosts.get(id)?.agent.cancel({kind:'user'},{keepInbox:true});return this.start(id,m.rawText,context,m.attachments);}
  async approve(id,callId,allow){const settle=this.approvals.get(callId);if(!settle)throw Error('确认请求已失效');settle(allow);return this.liveSessions.get(id)||this.store.get(id);}
  async setApprovalMode(id,mode){if(!['ask','auto'].includes(mode))throw Error('无效的执行授权模式');const s=this.liveSessions.get(id)||this.store.get(id);s.approvalMode=mode;if(mode==='auto')for(const c of s.calls.filter(c=>c.status==='pending'))this.approvals.get(c.id)?.(true);this.save(s);return s;}
  parkInbox(s,h,reason='stop'){if(!h)return;for(const input of [...h.agent.inbox.nextTurn,...h.agent.inbox.nextStep]){if(input.source.kind!=='user'){h.agent.inbox.remove(input.id);continue;}let q=(s.queuedMessages||=[]).find(q=>q.harnessMessageId===input.id);if(!q){q={id:input.id,harnessMessageId:input.id,rawText:input.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'),createdAt:new Date().toISOString()};s.queuedMessages.push(q);}q.heldInput=structuredClone(input);if(reason==='watch')q.holdForWatch=true;else q.paused=true;h.agent.inbox.remove(input.id);}}
  async stop(id){this.cancelEpoch.set(id,(this.cancelEpoch.get(id)||0)+1);const s=this.liveSessions.get(id)||this.store.get(id);this.parkInbox(s,this.hosts.get(id));this.hosts.get(id)?.cancel();s.watch=null;s.reviewWatch=null;delete s.currentReview;s.status='interrupted';this.save(s);if(s.screenMode==='virtual'){await this.screen?.interrupt?.(s);await this.hosts.get(id)?.idle();await this.finishScreen(s);}}
  disconnect(id){this.contexts.delete(id);const s=this.liveSessions.get(id)||this.store.get(id),h=this.hosts.get(id);h?.cancel();s.status=s.watch?'waiting':'interrupted';this.save(s);if(h){this.hosts.delete(id);const closing=h.dispose().then(()=>this.finishScreen(s)).finally(()=>this.closing.delete(id));this.closing.set(id,closing);}}
  recordFailure(s,error){
    if(s.currentReview?.failureRecorded)return;
    const review=s.currentReview;const diagnostics=error.diagnostics||error.cause?.diagnostics||{category:error.code||'model',message:error.message};
    const evidenceId=this.store.saveEvidence(s.id,randomUUID(),diagnostics,{toolName:'agent-review'});
    (s.reviewFailures||=[]).push({kind:review?.caseId?'case':'conversation',...(review?.caseId?{caseId:review.caseId,revision:review.revision}:{}),error:error.message,evidenceId});
    s.lastInterruption={category:diagnostics.category,at:new Date().toISOString(),error:error.message};
    if(review)review.failureRecorded=true;
  }
  async stopAll(){this.closed=true;for(const [id,h] of this.hosts){const s=this.liveSessions.get(id)||this.store.get(id);this.parkInbox(s,h);this.save(s);h.cancel();}await Promise.all([...this.liveSessions.values()].filter(s=>s.screenMode==='virtual').map(s=>this.screen?.interrupt?.(s)));await Promise.all([...this.hosts.values()].map(h=>h.dispose()));await Promise.all([...this.liveSessions.values()].map(s=>this.finishScreen(s)));let timer;try{await Promise.race([this.experiences.queue,new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);}finally{clearTimeout(timer);}this.active.clear();this.hosts.clear();}
  async finishScreen(s){
    if(s.screenMode!=='virtual'||s.screenCleanup?.confirmed===true)return;
    if(this.screenCleanups?.has(s.id))return this.screenCleanups.get(s.id);
    this.screenCleanups ||= new Map();
    const pending=(async()=>{
      try{const cleanup=await this.screen.finish(s);
        if(!cleanup?.success||cleanup.cleanupConfirmed!==true)throw Error('副屏清理未确认，请检查设备连接');
        s.screenCleanup={confirmed:true};this.save(s);
        if(cleanup.acknowledge){let removed=false;try{removed=cleanup.acknowledge()===true;}catch{}
          if(!removed)s.screenReport={...(s.screenReport||{status:'not_tested',reportPath:null,checkpoints:[]}),recoveryRecordRemovalFailed:true};}
      }catch(error){s.screenCleanup={confirmed:false};s.status='failed';s.error=error.message||'副屏清理未确认';}
      this.save(s);
    })();this.screenCleanups.set(s.id,pending);
    try{await pending;}finally{this.screenCleanups.delete(s.id);}
  }
  async retryScreenCleanup(id){
    if(this.active.has(id))throw Error('任务仍在执行或清理中');
    const s=this.liveSessions.get(id)||this.store.get(id);
    if(s.screenMode!=='virtual'||s.screenCleanup?.confirmed!==false)throw Error('没有待确认的副屏清理');
    await this.finishScreen(s);if(s.screenCleanup?.confirmed!==true)throw Error(s.error);return s;
  }
  retryScreenRecoveryRecord(id){
    if(this.active.has(id))throw Error('任务仍在执行');
    const s=this.liveSessions.get(id)||this.store.get(id);
    if(s.screenMode!=='virtual'||s.screenCleanup?.confirmed!==true||s.screenReport?.recoveryRecordRemovalFailed!==true)throw Error('没有可重试删除的恢复记录');
    if(this.screen.clear(s)!==true)throw Error('恢复记录仍未删除，请检查本机凭据存储');
    delete s.screenReport.recoveryRecordRemovalFailed;this.save(s);return s;
  }
  notify(kind,id,detail){
    const key=`${kind}:${id}`,previous=this.events.get(key);const cases=new Map((previous?.caseEvents||[]).map(e=>[e.revision,e]));for(const e of detail.caseEvents||[])cases.set(e.revision,e);
    this.events.set(key,{kind,id,...detail,caseEvents:[...cases.values()]});
    for(const summary of this.store.list()){
      const metadata=this.liveSessions.get(summary.id)||this.store.metadata(summary.id);
      const receipt=detail.executionReceipt;
      if(metadata.watch?.kind===kind&&metadata.watch.id===id&&receipt?.schemaVersion==='glassbox.task.result.v1'&&receipt.executionComplete&&['success','failed','stopped','completed','cancelled','interrupted'].includes(detail.status)){
        const s=this.liveSessions.get(summary.id)||this.store.get(summary.id);this.liveSessions.set(s.id,s);
        if(!s.messages.some(m=>m.source==='platform-result'&&m.taskResults?.some(r=>r.taskId===receipt.taskId&&r.observedAt===receipt.observedAt))){s.messages.push(require('./task-result-delivery').taskCompletionDelivery(receipt));this.save(s);}
      }
      if((metadata.status||metadata.summary?.status)==='waiting')this.resume(summary.id);
    }
  }
  resume(id){
    if(this.closed||this.active.has(id)||!this.contexts.has(id))return;
    let s=this.liveSessions.get(id)||this.store.metadata(id);if(!s.watch)return;
    const e=this.events.get(`${s.watch.kind}:${s.watch.id}`);if(!e)return;
    const continuation=require('./task-continuation').select(s.watch,e,s.reviewCursors?.[s.watch.id]||0);if(!continuation)return;
    const {allPending,next,record}=continuation;
    const watchedId=s.watch.id;s=this.liveSessions.get(id)||this.store.get(id);if(s.watch?.id!==watchedId)return;
    let evidenceId;
    try{evidenceId=this.store.saveEvidence(s.id,randomUUID(),record,{toolName:'platform-notice'});}
    catch(error){s.status='failed';s.error=`通知原记录保存失败，尚未消费事件：${error.code||'EVIDENCE_WRITE_FAILED'}`;this.save(s);return;}
    if(next)(s.reviewCursors||={})[s.watch.id]=next.revision;
    else{if(allPending.length)(s.reviewCursors||={})[s.watch.id]=allPending.at(-1).revision;s.watch=null;s.reviewWatch=null;}
    s.currentReview=next?{caseId:next.caseId,revision:next.revision}:{};s.status='running';this.save(s);
    const epoch=this.cancelEpoch.get(id)||0;
    const pendingRun=(async()=>{this.liveSessions.set(id,s);const h=await this.host(s,this.contexts.get(id));if(this.closed||epoch!==(this.cancelEpoch.get(id)||0)||!this.contexts.has(id))return;h.send(require('./task-continuation').notice(record,{caseEvent:!!next,contextRecord:{evidenceId,readTool:'read_context_record',pointers:next?['/caseSummary']:['/executionReceipt','/caseEvents','/recordingSession']}}),'platform');await h.idle();})().catch(error=>{s.status='failed';s.error=error.message;this.save(s);}).finally(()=>{this.active.delete(id);this.releaseWatchQueue(s,this.hosts.get(id));if(s.watch&&['failed','interrupted'].includes(s.status))s.status='waiting';this.save(s);if(!this.closed)this.resume(id);});
    this.active.set(id,pendingRun);
  }
}
module.exports={HarnessRuntime,SYSTEM};
