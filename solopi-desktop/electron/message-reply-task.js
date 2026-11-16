const { randomUUID, randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createMessageReplyEngine } = require('./message-reply-engine');

// Only the in-repository controlled fixture has the identity protocol used here.
const FIXTURE_PACKAGE = 'com.solopi.fastpath.replyfixture';

function createMessageReplyTask({ openSession, recoverSession, acknowledgeCleanup, engineStore, runStore, evidenceStore, generate, createGenerate,
  timers = globalThis, intervalMs = 2000, keepaliveMs = 180000, sessionDurationMs = 1680000,
  clock = () => performance.now(), wallClock = () => Date.now(), onChange = () => {} }) {
  if (typeof openSession !== 'function' || typeof recoverSession !== 'function' ||
      !Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000 ||
      !Number.isInteger(keepaliveMs) || keepaliveMs < 100 || keepaliveMs > 180000 ||
      !Number.isInteger(sessionDurationMs) || sessionDurationMs < 100 || sessionDurationMs > 1680000 ||
      typeof clock !== 'function' || typeof wallClock !== 'function') throw Error('invalid_reply_task');
  let session = null, engine = null, owner = null, evidenceRunId = null, starting = null, polling = null, timer = null, generation = 0, simulationAbort = null;
  let deviceCleanup = null;
  let deadlineAt = 0, wallDeadlineAt = 0, nextKeepaliveAt = 0, nextWallKeepaliveAt = 0;
  let taskStatus = { status:'stopped', reason:null, cleanupConfirmed:true, pending:false, processed:0 };
  try {
    const previousRun = runStore.load();
    const previousState = engineStore.load();
    if (previousRun?.owner) taskStatus = { ...taskStatus, status:'paused', reason:'cleanup_recovery_required', cleanupConfirmed:false };
    if (previousState?.pending) taskStatus = { ...taskStatus, status:'paused', pending:true,
      reason:previousRun?.owner ? 'cleanup_recovery_required' : 'send_requires_manual_review' };
    if (Array.isArray(previousState?.history)) taskStatus.processed = previousState.history.length;
  } catch {
    // Code security: corrupted or inaccessible records must never be treated as an empty ledger.
    taskStatus = { status:'paused', reason:'state_storage_unavailable', cleanupConfirmed:false, pending:false, processed:0 };
  }
  const emit = () => { try { onChange(status()); } catch { /* UI updates must not affect device control. */ } };
  function status() { return { ...taskStatus }; }
  function publish(value) { taskStatus = { ...taskStatus, ...value }; emit(); }
  function cancelTimer() { if (timer) timers.clearTimeout(timer); timer = null; }
  function schedule() {
    if (taskStatus.status !== 'running' || timer) return;
    timer = timers.setTimeout(() => { timer = null; void poll(); }, intervalMs);
    timer.unref?.();
  }
  async function cleanup() {
    cancelTimer();
    if (!owner) return true;
    try {
      if (!deviceCleanup) {
        const result = session ? await session.close() : await recoverSession(owner);
        if (result?.cleanupConfirmed !== true) throw Error('cleanup_unconfirmed');
        deviceCleanup = {recoveryRecordPendingAck:result.recoveryRecordPendingAck === true};
      }
      // Code security: persist the physical result before releasing its recovery
      // capability; local retries must never issue the device action again.
      runStore.save({owner, ...(evidenceRunId ? {evidenceRunId} : {}),
        deviceCleanupConfirmed:true, recoveryRecordPendingAck:deviceCleanup.recoveryRecordPendingAck});
      if (evidenceRunId) evidenceStore.complete(owner, evidenceRunId);
      if (deviceCleanup.recoveryRecordPendingAck &&
          (typeof acknowledgeCleanup !== 'function' || acknowledgeCleanup(owner) !== true))
        throw Error('cleanup_ack_unconfirmed');
      runStore.save({ owner:null });
      // Code security: discard the stopped engine before later review or history edits.
      session = null; owner = null; engine = null; evidenceRunId = null; deviceCleanup = null;
      publish({ cleanupConfirmed:true });
      return true;
    } catch {
      publish({ cleanupConfirmed:false, reason:'cleanup_unconfirmed' });
      return false;
    }
  }
  async function start(config) {
    if (starting || polling || owner || taskStatus.status === 'running') throw Error('reply_already_active');
    if (!config || typeof config.deviceId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(config.deviceId) ||
        config.contactId !== 'friend-1') throw Error('invalid_reply_configuration');
    // Freeze configuration once, including model selection, for this task only.
    const frozen = structuredClone(config);
    if (engineStore.load()?.pending) throw Error('send_requires_manual_review');
    const retained = runStore.load();
    if (retained?.owner) throw Error('cleanup_recovery_required');
    const expectedGeneration = ++generation;
    deadlineAt = clock() + sessionDurationMs;
    wallDeadlineAt = wallClock() + sessionDurationMs;
    owner = `reply-${randomUUID()}`;
    // Code security: persist the exact owner before the device session can be created.
    try {
      evidenceRunId = evidenceStore ? randomBytes(16).toString('hex') : null;
      if (evidenceRunId) evidenceStore.begin(owner, evidenceRunId);
      runStore.save({ owner, ...(evidenceRunId ? {evidenceRunId} : {}) });
    }
    catch (error) { owner = null; evidenceRunId = null; throw error; }
    publish({ status:'starting', reason:null, cleanupConfirmed:false, pending:false, processed:0 });
    const work = (async () => {
      try {
        session = await openSession({ owner, evidenceRunId, deviceId:frozen.deviceId, contactId:frozen.contactId, appId:FIXTURE_PACKAGE });
        if (generation !== expectedGeneration) throw Error('reply_start_cancelled');
        const taskGenerate = createGenerate ? createGenerate(frozen, session) : generate;
        if (typeof taskGenerate !== 'function') throw Error('invalid_reply_generator');
        engine = createMessageReplyEngine({ adapter:session, store:engineStore, generate:taskGenerate,
          imageEnabled:!!frozen.visionProvider,
          canProceed:() => clock() < deadlineAt && wallClock() < wallDeadlineAt });
        const value = await engine.start({ contactId:frozen.contactId });
        if (generation !== expectedGeneration) throw Error('reply_start_cancelled');
        publish({ ...value, cleanupConfirmed:false });
        nextKeepaliveAt = clock() + keepaliveMs;
        nextWallKeepaliveAt = wallClock() + keepaliveMs;
        schedule();
        return status();
      } catch (error) {
        try { engine?.stop(); } catch { /* Retain the prior durable record. */ }
        await cleanup();
        const reason = error.message === 'reply_start_cancelled' ? 'stopped'
          : error.message === 'session_duration_limit' ? 'session_duration_limit' : 'start_failed';
        publish({ status:'paused', reason:taskStatus.cleanupConfirmed ? reason : 'cleanup_unconfirmed' });
        throw error;
      }
    })();
    starting = work;
    try { return await work; } finally { if (starting === work) starting = null; }
  }
  async function poll() {
    if (!engine || taskStatus.status !== 'running' || polling) return status();
    const work = (async () => {
      try {
        let result = await engine.poll();
        if (result.status === 'running' && (clock() >= nextKeepaliveAt || wallClock() >= nextWallKeepaliveAt)) {
          result = await engine.maintain();
          nextKeepaliveAt = clock() + keepaliveMs;
          nextWallKeepaliveAt = wallClock() + keepaliveMs;
        }
        publish(result);
        if (result.status !== 'running') await cleanup();
        else schedule();
      } catch {
        publish({status:'paused',reason:'state_storage_unavailable'});
        await cleanup();
      }
      return status();
    })();
    polling = work;
    try { return await work; }
    finally { if (polling === work) polling = null; }
  }
  async function stop() {
    generation++;
    cancelTimer();
    simulationAbort?.abort();
    if (engine) {
      try { engine.stop(); } catch { publish({status:'paused',reason:'state_storage_unavailable'}); }
    }
    if (starting) await starting.catch(() => {});
    if (polling) await polling.catch(() => {});
    const confirmed = await cleanup();
    publish({ status:'paused', reason:confirmed ? 'stopped' : 'cleanup_unconfirmed' });
    return status();
  }
  async function simulateArrival(kind = 'text') {
    if (kind !== 'text' && kind !== 'image') throw Error('invalid_fixture_simulation');
    if (taskStatus.status !== 'running' || !session || !owner || !engine) throw Error('reply_not_running');
    if (starting || polling) throw Error('reply_busy');
    if (clock() >= deadlineAt || wallClock() >= wallDeadlineAt) return poll();
    const expectedGeneration = generation;
    const cancellation = new AbortController();
    simulationAbort = cancellation;
    cancelTimer();
    const work = (async () => {
      try {
        await session.simulateArrival({kind,signal:cancellation.signal,
          canProceed:() => clock() < deadlineAt && wallClock() < wallDeadlineAt});
        if (generation === expectedGeneration && taskStatus.status === 'running') schedule();
      } catch {
        // Code security: a partially executed physical sequence is never retried.
        try { engine.stop(); } catch { /* Cleanup still has to be attempted. */ }
        publish({status:'paused', reason:'fixture_simulation_failed'});
        await cleanup();
      }
      return status();
    })();
    polling = work;
    try { return await work; }
    finally { if (polling === work) polling = null; if (simulationAbort === cancellation) simulationAbort = null; }
  }
  async function recover() {
    if (starting || polling || taskStatus.status === 'running') throw Error('reply_already_active');
    if (!owner) {
      const saved = runStore.load();
      if (!saved?.owner) return status();
      if (typeof saved.owner !== 'string' || !/^reply-[0-9a-f-]{36}$/.test(saved.owner)) throw Error('invalid_reply_owner');
      owner = saved.owner;
      if (saved.evidenceRunId !== undefined) {
        if (!evidenceStore || typeof saved.evidenceRunId !== 'string' || !/^[0-9a-f]{32}$/.test(saved.evidenceRunId)) throw Error('reply_evidence_unavailable');
        evidenceRunId = saved.evidenceRunId;
      }
      if (saved.deviceCleanupConfirmed === true) {
        if (typeof saved.recoveryRecordPendingAck !== 'boolean') throw Error('reply_evidence_unavailable');
        deviceCleanup = {recoveryRecordPendingAck:saved.recoveryRecordPendingAck};
      }
    }
    publish({ status:'paused', reason:'cleanup_recovery_required', cleanupConfirmed:false });
    if (await cleanup()) publish({status:'paused',reason:taskStatus.pending ? 'send_requires_manual_review' : 'stopped'});
    return status();
  }
  function reviewPending(expectedId) {
    if (starting || polling || owner || session || taskStatus.status === 'running' || taskStatus.status === 'starting')
      throw Error('reply_already_active');
    if (taskStatus.cleanupConfirmed !== true || runStore.load()?.owner) throw Error('cleanup_recovery_required');
    // Code security: review only clears the exact stopped session's uncertain intent;
    // it never declares delivery or triggers a device action.
    engineStore.reviewPending(expectedId);
    const latest = engineStore.load();
    publish({status:'paused',reason:'stopped',pending:false,processed:Array.isArray(latest?.history) ? latest.history.length : 0});
    return status();
  }
  function listEvidence() { if (!evidenceStore) throw Error('reply_evidence_unavailable'); return evidenceStore.list(); }
  function removeEvidence(id) {
    if (!evidenceStore) throw Error('reply_evidence_unavailable');
    // Code security: deletion is serialized in the main process and fails closed on any live or uncertain owner.
    if (starting || polling || owner || session || !taskStatus.cleanupConfirmed || taskStatus.pending ||
        ['running','starting'].includes(taskStatus.status) || runStore.load()?.owner || engineStore.load()?.pending)
      throw Error('reply_evidence_busy');
    evidenceStore.remove(id);
  }
  return { start, poll, pause:stop, stop, recover, reviewPending, simulateArrival, status, listEvidence, removeEvidence };
}
module.exports = { createMessageReplyTask, FIXTURE_PACKAGE };
