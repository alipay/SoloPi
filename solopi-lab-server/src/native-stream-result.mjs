// Normalize native model protocol finishes before the shared compaction engine.
// A truncated summary is data for its bounded recovery; ordinary turns still fail.
export function nativeStreamResult(session,{purpose='conversation',sawFinish=false}={}){
 const finish=session?.assembler?.finish;
 if(!sawFinish||!finish)throw Object.assign(Error('Missing native stream finish'),{code:'INCOMPLETE_STREAM'});
 if(finish.kind==='error'||finish.kind==='aborted')throw Object.assign(Error('Native stream failed'),{code:finish.failure?.code||'INCOMPLETE_STREAM',failure:finish.failure});
 const limited=finish.kind==='max-tokens';
 if(limited&&purpose!=='compaction')throw Object.assign(Error('Native output limit reached'),{code:'OUTPUT_LIMIT'});
 const blocks=session.assembler.blocks(),calls=blocks.filter(b=>b.type==='tool-call');
 const content=blocks.filter(b=>b.type==='text').map(b=>b.text).join('');
 const reasoning=blocks.filter(b=>b.type==='reasoning').map(b=>b.text).join('');
 if(purpose==='compaction'&&calls.length)throw Object.assign(Error('Summary returned tool calls; not executed'),{code:'SUMMARY_TOOL_CALLS'});
 if(!limited&&!calls.length&&!content.trim())throw Object.assign(Error('Native response empty'),{code:'EMPTY_RESPONSE'});
 const usage=session.assembler.usage;
 return{content,...(reasoning?{reasoning_content:reasoning}:{}),...(calls.length?{tool_calls:calls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:c.arguments}}))}:{}),finish_reason:limited?'length':calls.length?'tool_calls':'stop',...(usage?{usage:{prompt_tokens:usage.inputTokens,completion_tokens:usage.outputTokens}}:{})};
}
