// Credentials belong to the configured endpoint, including its API path.
export function modelApiKey(input, previous = {}) {
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) return input.apiKey;
  const endpoint = value => {
    try { return new URL(value).href.replace(/\/+$/, ''); } catch { return null; }
  };
  const next = endpoint(input.baseUrl);
  return next && next === endpoint(previous.baseUrl) ? previous.apiKey : undefined;
}
