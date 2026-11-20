const modelErrors = new Map<string, string>([
  ['network', 'Could not reach the model service. Check the network, proxy, or VPN.'],
  ['dns', 'Could not resolve the model service hostname. Check DNS and network settings.'],
  ['tls', 'Could not verify the model service certificate. Check the certificate chain and proxy settings.'],
  ['refused', 'The model service refused the connection. Check the service address, port, and proxy.'],
  ['cancelled', 'The model request was cancelled.'],
  ['disconnected', 'The model connection dropped. Check the network and model service.'],
  ['timeout', 'The model request timed out. Check the service or adjust the request timeout in Settings.'],
  ['rate-limit', 'The model service rate limit was reached. Wait before trying again or check your quota.'],
  ['upstream', 'The model service returned an error. Expand diagnostics for the upstream code and request ID.'],
  ['redirect-blocked', 'The model endpoint redirected the request. Check the configured endpoint URL.'],
  ['input-budget', 'The request exceeded the input budget. Reduce the input or adjust the budget in Settings.'],
  ['context-overflow', 'The request exceeded the model context window. Reduce the input and try again.'],
  ['output-limit', 'The model reached its output limit. Adjust the output limit or reasoning settings.'],
  ['empty-response', 'The model returned no usable text or tool calls.'],
  ['invalid-tool-call', 'The model returned invalid tool arguments. The affected operation was not run.'],
  ['tool_arguments', 'The tool arguments could not be validated. See diagnostics for details.'],
  ['summary-truncated', 'The context summary ended early. The original conversation context was retained.'],
  ['response-truncated', 'The model response ended early. The incomplete tool calls were not run.'],
  ['response', 'The model response could not be processed. Check the endpoint and response diagnostics.'],
  ['task-incomplete', 'The Agent stopped with the task unfinished. Completed operation receipts are available in the conversation.'],
]);

const exactErrors = new Map<string, string>([
  ['请先在设置中心添加支持工具调用的模型', 'Add a model with tool-calling support in Settings to start a conversation.'],
  ['请输入 1–16000 字的消息', 'Enter a message between 1 and 16,000 characters.'],
  ['对话正在停止，请稍后发送', 'The conversation is stopping. Wait before sending another message.'],
  ['对话已停止，已提交的任务请在任务列表查看。', 'The conversation stopped. Open Test runs to see any submitted tasks.'],
  ['此前副屏清理未确认，请先恢复设备会话', 'Background screen cleanup is unconfirmed. Recover the device session before continuing.'],
  ['本机恢复记录尚未删除，请先在本对话重试删除恢复记录', 'Retry deleting the local recovery record in this conversation before continuing.'],
  ['副屏清理未确认，请勿重新操作设备', 'Background screen cleanup is unconfirmed. Do not run another device operation yet.'],
  ['模型对照进行中，请等待或停止对照后发送', 'Wait for the model comparison to finish or stop it before sending another message.'],
  ['模型配置不存在，请刷新模型列表', 'The model configuration was not found. Refresh the model list.'],
]);

export function englishAgentError(raw: string, details: unknown): string | undefined {
  if (details && typeof details === 'object') {
    const { category, httpStatus } = details as { category?: unknown; httpStatus?: unknown };
    if (httpStatus === 401) return 'Model authentication failed. Check the API key in Settings.';
    if (httpStatus === 403) return 'The model service denied access. Check account permissions and gateway access policy.';
    if (httpStatus === 429) return modelErrors.get('rate-limit');
    if (typeof httpStatus === 'number' && httpStatus >= 500 && httpStatus < 600) return 'The model service is temporarily unavailable. Try again later.';
    if (category === 'http') return 'The model service rejected the request. Check the model configuration and endpoint compatibility.';
    if (typeof category === 'string' && modelErrors.has(category)) return modelErrors.get(category);
  }
  return exactErrors.get(raw);
}
