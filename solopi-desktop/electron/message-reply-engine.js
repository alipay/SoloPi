// The adapter is responsible for proving conversation and message identity from
// the current device observation. Notification data is never accepted here.
function createMessageReplyEngine({ adapter, store, generate, imageEnabled = false, canProceed = () => true }) {
  let running = false;
  let busy = false;
  let state = null;
  let generation = 0;
  let cancellation = null;

  function validSnapshot(snapshot, contact) {
    if (!snapshot || snapshot.contactId !== contact || snapshot.identityVerified !== true ||
        snapshot.complete !== true || typeof snapshot.observationId !== 'string' || !snapshot.observationId ||
        !Array.isArray(snapshot.messages) || snapshot.messages.length > 10000) return false;
    const ids = new Set();
    for (const message of snapshot.messages) {
      if (!message || typeof message.id !== 'string' || !message.id || message.id.length > 256 || ids.has(message.id) ||
          !['incoming', 'outgoing', 'system'].includes(message.direction) ||
          !['text', 'image', 'other'].includes(message.kind)) return false;
      ids.add(message.id);
    }
    return true;
  }

  function pause(reason) {
    running = false;
    cancellation?.abort();
    state = { ...state, status: 'paused', reason };
    store.save(state);
  }
  function withinDeadline() {
    if (canProceed()) return true;
    if (running) pause('session_duration_limit');
    return false;
  }

  async function start(config) {
    if (running || busy) throw Error('reply_already_running');
    if (!config || typeof config.contactId !== 'string' || !config.contactId.trim()) throw Error('contact_required');
    const currentGeneration = ++generation;
    cancellation = new AbortController();
    busy = true;
    try {
      const previous = store.load();
      if (previous?.pending) throw Error('send_requires_manual_review');
      const wake = await adapter.notificationStatus();
      if (!wake?.available || typeof wake.epoch !== 'string' || !Number.isSafeInteger(wake.sequence)) throw Error('notification_unavailable');
      const snapshot = await adapter.observe(config.contactId);
      if (generation !== currentGeneration) throw Error('reply_start_cancelled');
      if (!canProceed()) throw Error('session_duration_limit');
      if (!validSnapshot(snapshot, config.contactId)) throw Error('conversation_identity_unconfirmed');
      // Code security: only a verified snapshot establishes the initial baseline.
      state = { status: 'running', contactId: config.contactId, epoch: wake.epoch, sequence: wake.sequence,
        seen: snapshot.messages.map(message => message.id), pending: null,
        history: Array.isArray(previous?.history) ? previous.history.slice(-1000) : [] };
      store.save(state);
      running = true;
      return status();
    } finally { busy = false; }
  }

  async function poll() {
    if (!running || busy) return status();
    busy = true;
    try {
      if (!withinDeadline()) return status();
      const wake = await adapter.notificationStatus();
      if (!running) return status();
      if (!withinDeadline()) return status();
      if (!wake?.available || wake.epoch !== state.epoch || !Number.isSafeInteger(wake.sequence) || wake.sequence < state.sequence) {
        pause('notification_interrupted');
        return status();
      }
      if (wake.sequence === state.sequence) return status();
      const snapshot = await adapter.observe(state.contactId);
      if (!running) return status();
      if (!validSnapshot(snapshot, state.contactId)) { pause('conversation_identity_unconfirmed'); return status(); }
      const known = new Set(state.seen);
      // Missing baseline entries can indicate scrolling, truncation or replacement.
      if (state.seen.some(id => !snapshot.messages.some(message => message.id === id))) {
        pause('message_history_unconfirmed'); return status();
      }
      const fresh = snapshot.messages.filter(message => !known.has(message.id));
      for (const message of fresh) {
        if (!running) break;
        if (!withinDeadline()) return status();
        if (message.direction !== 'incoming' || !['text', 'image'].includes(message.kind)) {
          state.seen.push(message.id);
          continue;
        }
        if (message.retracted !== false || message.unique !== true || message.afterBaseline !== true ||
            (message.kind === 'text' && (typeof message.text !== 'string' || !message.text.trim() || message.isQuestion !== true)) ||
            (message.kind === 'image' && message.imageVerified !== true)) {
          state.seen.push(message.id);
          state.history.push({ id: message.id, status: 'skipped' });
          continue;
        }
        if (message.kind === 'image' && !imageEnabled) {
          // Code security: the task's frozen capability is checked before image capture or model access.
          state.seen.push(message.id);
          state.history.push({ id: message.id, status: 'skipped', reason: 'image_model_not_configured' });
          continue;
        }
        const reply = await generate(message, snapshot, {signal:cancellation.signal});
        if (!running) return status();
        if (!withinDeadline()) return status();
        if (typeof reply !== 'string' || !reply.trim() || reply.length > 2000) throw Error('invalid_model_reply');
        const latestWake = await adapter.notificationStatus();
        if (!running) return status();
        if (!withinDeadline()) return status();
        if (!latestWake?.available || latestWake.epoch !== state.epoch || !Number.isSafeInteger(latestWake.sequence) || latestWake.sequence < wake.sequence) {
          pause('notification_interrupted'); return status();
        }
        // Code security: persist the intent before dispatch. A crash at any point
        // afterwards requires review, even if the actual send never occurred.
        state.pending = { id: message.id, status: 'dispatching', reply, observationId:snapshot.observationId,
          ...(message.kind === 'text' && typeof message.text === 'string' ? { text:message.text.slice(0, 4000) } : {}) };
        store.save(state);
        const receipt = await adapter.send({ contactId: state.contactId, messageId: message.id,
          observationId: snapshot.observationId, reply, signal:cancellation.signal });
        if (receipt?.confirmed !== true || receipt.contactId !== state.contactId || receipt.messageId !== message.id ||
            receipt.observationId !== snapshot.observationId || receipt.contentVerified !== true ||
            typeof receipt.outgoingId !== 'string' || !receipt.outgoingId) {
          pause('send_outcome_unknown'); return status();
        }
        state.seen.push(message.id);
        state.history.push({ id: message.id, status: 'sent', reply, outgoingId:receipt.outgoingId,
          ...(message.kind === 'text' && typeof message.text === 'string' ? { text:message.text.slice(0, 4000) } : {}) });
        if (state.history.length > 1000) state.history = state.history.slice(-1000);
        state.pending = null;
        store.save(state);
        // Any send changes the observation. Re-observe on a subsequent wake;
        // do not dispatch multiple messages from a stale snapshot.
        if (fresh.indexOf(message) !== fresh.length - 1) return status();
      }
      state.sequence = wake.sequence;
      store.save(state);
    } catch (error) {
      if (running || state?.pending) pause(state?.pending ? 'send_outcome_unknown'
        : error?.code === 'knowledge_records_unavailable' ? 'knowledge_records_unavailable' : 'processing_failed');
    } finally { busy = false; }
    return status();
  }

  async function maintain() {
    if (!running || busy) return status();
    busy = true;
    try {
      if (!withinDeadline()) return status();
      const snapshot = await adapter.observe(state.contactId);
      if (!running || !withinDeadline()) return status();
      if (!validSnapshot(snapshot, state.contactId)) pause('conversation_identity_unconfirmed');
      else if (state.seen.some(id => !snapshot.messages.some(message => message.id === id)))
        pause('message_history_unconfirmed');
      // Code security: keepalive never consumes a new message or causes a reply.
    } catch { if (running) pause('processing_failed'); }
    finally { busy = false; }
    return status();
  }

  function stop() {
    generation++;
    cancellation?.abort();
    if (state) pause('stopped');
    return status();
  }
  function status() {
    return state ? { status: state.status, reason: state.reason || null, pending: !!state.pending,
      processed: state.history.length } : { status: 'stopped', reason: null, pending: false, processed: 0 };
  }
  return { start, poll, maintain, stop, status };
}
module.exports = { createMessageReplyEngine };
