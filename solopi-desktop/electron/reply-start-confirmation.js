const { randomUUID } = require('node:crypto');
const { endpoint } = require('./agent/model');

function providerSummary(provider) {
  if (!provider || typeof provider.baseUrl !== 'string' || typeof provider.model !== 'string' || !provider.model.trim())
    throw Error('reply_model_unavailable');
  let url;
  try { url = new URL(provider.baseUrl); } catch { throw Error('reply_model_address_invalid'); }
  // Code security: a confirmation must not expose credentials embedded in URLs.
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw Error('reply_model_address_invalid');
  return { address:endpoint(provider.baseUrl), model:provider.model };
}

function createReplyStartConfirmation({ clock = () => Date.now(), makeId = randomUUID, ttlMs = 300000 } = {}) {
  let pending = null;
  let timer = null;
  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }
  return {
    prepare(config) {
      clear();
      const frozen = structuredClone(config);
      const text = providerSummary(frozen.textProvider);
      const vision = frozen.visionProvider ? providerSummary(frozen.visionProvider) : null;
      const token = makeId();
      pending = { token, expires:clock() + ttlMs, config:frozen };
      timer = setTimeout(clear, ttlMs);
      timer.unref?.();
      return { token, deviceId:frozen.deviceId, contact:'受控测试联系人 (friend-1)',
        text, vision, contextCount:frozen.contextCount };
    },
    consume(token) {
      const current = pending;
      // Code security: a confirmation is single-use and binds the frozen main-process configuration.
      clear();
      if (!current || typeof token !== 'string' || token !== current.token || clock() >= current.expires)
        throw Error('reply_confirmation_expired');
      return current.config;
    },
    cancel(token) {
      if (pending && pending.token === token) clear();
    },
  };
}

module.exports = { createReplyStartConfirmation };
