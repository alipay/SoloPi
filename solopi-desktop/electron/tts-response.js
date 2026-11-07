const TTS_SUCCESS_STATUS_VALUES = new Set([
  '0',
  '200',
  'ok',
  'success',
  'succeeded',
  'true',
]);

function hasOwn(value, key) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, key);
}

function isSuccessfulTtsBusinessStatus(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return true;
  }
  return TTS_SUCCESS_STATUS_VALUES.has(String(value).trim().toLowerCase());
}

function classifyTtsBusinessResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      failed: false,
      status: undefined,
      message: '',
      traceId: '',
    };
  }

  const hasStatus = hasOwn(body, 'status');
  const hasSuccess = hasOwn(body, 'success');
  const statusFailed = hasStatus && !isSuccessfulTtsBusinessStatus(body.status);
  const successFailed = hasSuccess && (
    body.success === false
    || String(body.success).trim().toLowerCase() === 'false'
  );
  const message = String(
    body.msg
    ?? body.message
    ?? body.error?.message
    ?? ''
  ).trim();
  const traceId = String(
    body.traceId
    ?? body.traceID
    ?? body.requestId
    ?? ''
  ).trim();

  return {
    failed: statusFailed || successFailed,
    status: hasStatus ? body.status : (hasSuccess ? body.success : undefined),
    message,
    traceId,
  };
}

function getTtsResponseRecoveryActions(code, details = {}) {
  if (code === 'TTS_BUSINESS_ERROR') {
    const traceHint = details.traceId ? `（traceId: ${details.traceId}）` : '';
    return [
      `根据响应中的 status/msg/traceId 检查上游 TTS 与 Maya 服务日志${traceHint}。`,
      '确认上游服务恢复并能返回非空音频 URL 后，再重试当前 TTS 节点。',
      '若相同业务状态持续出现，将原始 HTTP 响应和 traceId 提供给 TTS 服务责任方排查。',
    ];
  }

  if (code === 'TTS_RESPONSE_FIELD_MISSING') {
    return [
      '确认 TTS 业务响应成功，并检查设置中心配置的音频响应字段路径。',
      '在接口测试中查看原始与解析后的响应 Body，再修正 URL/音频字段路径。',
    ];
  }

  if (code === 'TTS_RESPONSE_INVALID_JSON') {
    return [
      '检查 TTS 服务是否返回合法 JSON，并核对 Content-Type 与响应类型配置。',
      '在接口测试中查看原始响应 Body，修复上游响应或调整 TTS 配置后重试。',
    ];
  }

  if (code === 'TTS_HTTP_ERROR') {
    return [
      '检查 TTS 服务 HTTP 状态、网络、鉴权和请求参数。',
      '根据原始响应 Body 修复上游错误后重试。',
    ];
  }

  if (code === 'TTS_AUDIO_DOWNLOAD_ERROR') {
    return [
      '确认 TTS 返回的音频 URL 可访问且未过期。',
      '检查音频下载服务的网络、鉴权与 HTTP 响应后重试。',
    ];
  }

  return [
    '查看节点输出中的原始 HTTP 响应，确认 TTS 服务状态与返回结构。',
    '修复 TTS 服务或配置后重试当前节点。',
  ];
}

module.exports = {
  classifyTtsBusinessResponse,
  getTtsResponseRecoveryActions,
  isSuccessfulTtsBusinessStatus,
};
