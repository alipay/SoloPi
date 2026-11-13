// Workflow generation/assertions need complete outputs. Never accept a truncated prefix.
function createOutputPolicy(provider = {}, options = {}) {
  const active = options.workflowOutput === true;
  const configured = Number(options.maxTokens);
  let maxTokens = Number.isFinite(configured) && configured > 0 ? Math.ceil(configured) : 1024;
  const initialMaxTokens = maxTokens;
  let recoveries = 0;
  // Respect explicit thinking choices; use non-thinking for bounded workflow outputs
  // only when the provider has confirmed support for this request option.
  const disableThinking = options.disableThinking ?? (
    active && provider.capabilities?.thinking === 'supported' && provider.thinking !== 'enabled'
  );
  return {
    options: () => active ? ({ ...options, maxTokens, disableThinking,
      enableThinking: !disableThinking && provider.thinking === 'enabled' && provider.capabilities?.thinking === 'supported',
    }) : options,
    recover(error) {
      if (!active || error?.code !== 'LLM_RESPONSE_TRUNCATED' || recoveries || maxTokens >= 8192) return false;
      maxTokens = Math.min(8192, Math.max(1024, maxTokens * 4));
      recoveries++;
      return true;
    },
    diagnostics: () => ({ initialMaxTokens, effectiveMaxTokens: maxTokens, truncationRecoveries: recoveries, disableThinking }),
  };
}
module.exports = { createOutputPolicy };
