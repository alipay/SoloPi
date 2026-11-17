// Summary reasoning can use an explicit generic override; conversation settings stay unchanged.
// Reasoning replay belongs to the original conversation, not the summary request.
function compactionReasoning(provider = {}) {
  if(provider.requestPolicy?.summaryReasoning==='disabled')
    return {...provider,thinking:'disabled',reasoningEffort:undefined,reasoningReplay:undefined};
  if(provider.requestPolicy?.summaryReasoning==='low')
    return {...provider,thinking:provider.capabilities?.thinking==='supported'?'enabled':undefined,reasoningEffort:'low',reasoningReplay:undefined};
  return { ...provider, reasoningReplay: undefined };
}
function conversationReasoning(provider={}) {
  if(provider.requestPolicy?.conversationReasoning!=='low')return {...provider};
  // An explicit per-purpose effort overrides a stale provider-level off flag.
  // Do not invent a provider-specific thinking option without capability proof.
  return {...provider,reasoningEffort:'low',...(provider.thinking==='disabled'
    ? {thinking:provider.capabilities?.thinking==='supported'?'enabled':undefined} : {})};
}
// Only a positively probed capability permits sending a new provider option.
// Recovery affects this summary attempt alone, never the saved conversation config.
function compactionRecoveryReasoning(provider={}) {
  const summary=compactionReasoning(provider);
  return provider.capabilities?.thinking==='supported'
    ? {...summary,thinking:'disabled',reasoningEffort:undefined} : summary;
}
module.exports = { compactionReasoning, compactionRecoveryReasoning, conversationReasoning };
