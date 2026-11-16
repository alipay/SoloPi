const {createHash}=require('node:crypto');
const {wireMessage}=require('./context');
function requestHash(messages) {
 return createHash('sha256').update(JSON.stringify(messages.map(m=>wireMessage(m,true)))).digest('hex');
}
function headerHash(header) { return createHash('sha256').update(JSON.stringify(header)).digest('hex'); }
function normalizeUsageAnchors(session) {
 for(const message of session.messages || []) {
  const anchor=message.usageAnchor;
  if(anchor?.header && typeof anchor.header==='object') {
   anchor.headerHash=headerHash(anchor.header);delete anchor.header;
  }
 }
 return session;
}
function usageAnchor(data,{provider,messages,tools,maxTokens}) {
 const u=data.usage;
 if(!Number.isSafeInteger(u?.prompt_tokens) || u.prompt_tokens<0 || !Number.isSafeInteger(u?.completion_tokens) || u.completion_tokens<0) return undefined;
 // Chat Completions prompt_tokens already includes cache hits. Do not add them twice.
 return {requestHash:requestHash(messages),headerHash:headerHash({config:{provider:'solopi-desktop',model:provider.model,maxTokens:maxTokens ?? 16384},...(tools.length?{tools:JSON.parse(JSON.stringify(tools.map(t=>t.function || t)))}:{})}),
  usage:{inputTokens:u.prompt_tokens,outputTokens:u.completion_tokens}};
}
module.exports={requestHash,headerHash,normalizeUsageAnchors,usageAnchor};
