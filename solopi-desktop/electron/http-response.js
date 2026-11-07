const SENSITIVE_HTTP_FIELD_PATTERN = /authorization|proxy-authorization|api[-_]?key|client[-_]?key|private[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|(?:^|[-_])token(?:$|[-_])|(?:^|[-_])key(?:$|[-_])|x[-_].*token|cookie|set-cookie|secret|password|credential|signature/i;

function isSensitiveHttpFieldName(value) {
  const fieldName = String(value || '');
  const compactName = fieldName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SENSITIVE_HTTP_FIELD_PATTERN.test(fieldName)
    || compactName === 'token'
    || compactName === 'key'
    || compactName.endsWith('token')
    || /^(?:api|client|private|access|auth|encryption|signing)key$/.test(compactName);
}

function sanitizeHttpResponseHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [
      key,
      isSensitiveHttpFieldName(key)
        ? '[REDACTED]'
        : value,
    ])
  );
}

function sanitizeHttpResponseBody(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeHttpResponseBody(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveHttpFieldName(key) ? '[REDACTED]' : sanitizeHttpResponseBody(item),
      ])
    );
  }
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(
      /("(?:(?:[^"]*(?:authorization|token|api[-_]?key|client[-_]?key|private[-_]?key|cookie|secret|password|credential|signature)[^"]*)|key)"\s*:\s*")[^"]*(")/gi,
      '$1[REDACTED]$2'
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|password|credential|signature|sig)=)[^&#\s"']+/gi,
      '$1[REDACTED]'
    );
}

function createHttpResponseEvidence(response, rawBody = '', parsedBody = undefined) {
  return {
    status: response?.status ?? null,
    statusText: response?.statusText || '',
    headers: sanitizeHttpResponseHeaders(
      response?.headers && typeof response.headers.entries === 'function'
        ? Object.fromEntries(response.headers.entries())
        : response?.headers || {}
    ),
    rawBody: sanitizeHttpResponseBody(String(rawBody ?? '')),
    ...(parsedBody !== undefined ? { body: sanitizeHttpResponseBody(parsedBody) } : {}),
  };
}

function formatHttpResponseEvidence(evidence = {}) {
  const parsedBody = evidence.body === undefined
    ? '(未解析)'
    : typeof evidence.body === 'string'
      ? evidence.body
      : JSON.stringify(evidence.body, null, 2);

  return [
    `HTTP 状态：${evidence.status ?? '-'} ${evidence.statusText || ''}`.trim(),
    `响应头：\n${JSON.stringify(evidence.headers || {}, null, 2)}`,
    `原始响应 Body：\n${evidence.rawBody || '(empty)'}`,
    `解析响应 Body：\n${parsedBody || '(empty)'}`,
  ].join('\n\n');
}

module.exports = {
  createHttpResponseEvidence,
  formatHttpResponseEvidence,
  isSensitiveHttpFieldName,
  sanitizeHttpResponseBody,
  sanitizeHttpResponseHeaders,
};
