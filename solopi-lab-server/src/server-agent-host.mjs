// Server lifecycle adapter only. Desktop owns the complete Harness composition.
import {createHarnessHost} from './desktop-agent/harness-host.mjs';
import recovery from './desktop-agent/harness-request-recovery.js';
import local from './local-runtime.cjs';
import capacity from './desktop-agent/model-capacity.js';
import {recordDiagnostic} from './diagnostics.mjs';

export async function serverAgentHost(input) {
 let current=input;let {id,directory,provider,system,tools,onEvent=()=>{},model,scopeKey,skillCatalog,onStream=()=>{},cwd,attachments=[]}=input;
 if(provider.mode==='local-runtime'){if(!provider.model?.trim())provider=await local.resolveProvider(provider);provider={contextWindowTokens:131072,...provider};}else provider=await capacity.resolveModelCapacity(provider);
 let trace=new recovery.RequestFailureTrace();let error,interrupted=false;
 const observe=record=>{trace.model(record);recordDiagnostic({...record,source:'server-superagent',conversationId:id,scopeKey});current.onEvent?.({type:record.event,data:record});};
 const retry=recovery.retryPolicy;
 const host=await createHarnessHost({id,provider,tools:tools.map(tool=>({...tool,execute:(args,exec)=>current.tools.find(t=>t.name===tool.name).execute(args,exec)})),system:()=>current.system,model:model|| (provider.mode==='local-runtime'?local.requestModel:undefined),persistenceDirectory:directory,skillCatalog,
  onStream:frame=>current.onStream?.(frame),beforeTool:exec=>current.beforeTool?.(exec),cwd,
  onModel:observe,onError:e=>{error=trace.decorate(e);},onIncomplete:()=>{error=Object.assign(Error('存在未完成的工具调用参数纠正'),{code:'UNRESOLVED_TOOL_ARGUMENTS'});},
  onEvent:event=>{if(event.type==='turn/end'&&['aborted','interrupted','blocked','max-tokens'].includes(event.data?.reason?.kind))interrupted=true;trace.event(event);if(event.type.startsWith('llm/retry'))recordDiagnostic({event:event.type,scopeKey,conversationId:id,attempt:event.data.retry,maxRetries:event.data.maxRetries,delayMs:event.data.delayMs,code:event.data.failure?.code});current.onEvent?.(event);}
 });
 if(cwd&&host.ctx.workingDirectory.get(host.agent.session)!==cwd)await host.ctx.workingDirectory.set(host.agent,cwd);
 return {update(next){current=next;},async send(text,source='user'){trace=new recovery.RequestFailureTrace();error=undefined;interrupted=false;const attachments=current.attachments||[];if(attachments.length&&source==='user')host.agent.send(await host.input(text,attachments),'next-turn',true);else await host.send(text,source);await host.idle();if(error)throw error;if(interrupted)throw Object.assign(Error('Agent 本轮已停止，已提交操作保留'),{code:'AGENT_INTERRUPTED'});},cancel:()=>host.cancel(),dispose:()=>host.dispose()};
}
