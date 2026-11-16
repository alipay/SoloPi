// SoloPi Desktop owns the stdio process, device lease and artifact paths.
// No command string, executable, arbitrary path or remote URL crosses this IPC surface.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');

const MAX_RESPONSE = 32 * 1024 * 1024;
const MAX_REQUEST = 1024 * 1024;
const OPERATIONS = new Set(['discover', 'apps', 'connect', 'command', 'disconnect', 'replay',
  'virtual_start', 'virtual_observe', 'virtual_act', 'virtual_end', 'virtual_preview', 'virtual_notification_status',
  'virtual_fixture_input', 'virtual_fixture_send', 'virtual_fixture_crop']);

function validateVirtualReport(root, candidate) {
  if (typeof candidate !== 'string' || path.basename(candidate) !== 'report.html'
      || !/^virtual-[0-9a-f]{32}$/.test(path.basename(path.dirname(candidate)))) throw Error('invalid_virtual_report');
  // Code security: both paths are resolved before containment; renderer/model never select a path.
  const base = fs.realpathSync(root), real = fs.realpathSync(candidate), relative = path.relative(base, real);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)
      || path.basename(real) !== 'report.html') throw Error('invalid_virtual_report');
  return real;
}

function validateTarget(value) {
  if (!value || !['android', 'ios', 'harmony_next'].includes(value.platform)
      || !['physical', 'simulator'].includes(value.deviceKind)
      || typeof value.deviceId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.deviceId)
      || typeof value.appId !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,199}$/.test(value.appId)) {
    throw new Error('invalid_device_config');
  }
  if (value.platform === 'harmony_next' && (value.deviceKind !== 'simulator' || !value.deviceId.startsWith('127.0.0.1:'))) {
    throw new Error('physical_harmony_not_validated');
  }
  return value;
}

function createHarnessControl({ sourceDirectory, artifactDirectory, gate, adbPath, recoveryStore, spawnProcess = spawn }) {
  let child = null;
  let pending = null;
  let buffer = '';
  let lease = null;
  let connected = false;
  let busy = false;
  let lastArtifacts = null;
  let leaseKind = null;
  let virtualOutcomeUnknown = false;
  let virtualOwner = null;
  let virtualRecovery = null;
  let virtualRecoverRequired = false;
  let virtualRecoveryPersisted = false;

  function release({ keepRecovery = false } = {}) {
    let recoveryRecordRemoved = true;
    if (virtualRecoveryPersisted && !keepRecovery) {
      try { recoveryStore.remove(virtualOwner); } catch { recoveryRecordRemoved = false; }
    }
    lease?.release();
    lease = null;
    connected = false;
    leaseKind = null;
    virtualOutcomeUnknown = false;
    virtualOwner = null;
    virtualRecovery = null;
    virtualRecoverRequired = false;
    virtualRecoveryPersisted = false;
    return recoveryRecordRemoved;
  }

  function start() {
    if (child) return;
    const source = path.resolve(sourceDirectory());
    if (!fs.existsSync(path.join(source, 'solopi_harness', 'desktop_control.py'))) {
      throw new Error('harness_source_missing');
    }
    fs.mkdirSync(artifactDirectory(), { recursive: true, mode: 0o700 });
    buffer = '';
    // Code security: argv only, trusted installation paths, no renderer-controlled shell/environment.
    const processHandle = spawnProcess(process.env.SOLOPI_HARNESS_PYTHON || 'python3',
      ['-u', '-m', 'solopi_harness.desktop_control', '--artifacts', path.resolve(artifactDirectory())], {
        shell: false, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: source, PYTHONUTF8: '1', ADB: adbPath() },
      });
    child = processHandle;
    processHandle.stdout.setEncoding('utf8');
    processHandle.stdout.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_RESPONSE) {
        fail(new Error('harness_response_too_large'));
        processHandle.kill('SIGTERM');
        return;
      }
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let response;
        try { response = JSON.parse(line); } catch { continue; }
        if (pending && response.id === pending.id) {
          const request = pending;
          pending = null;
          clearTimeout(request.timer);
          request.resolve(response);
        }
      }
    });
    // Consume stderr without returning raw traces, commands or device data to the renderer.
    processHandle.stderr.resume();
    processHandle.stdin.on('error', () => fail(new Error('harness_pipe_closed')));
    processHandle.on('error', () => fail(new Error('python_runtime_unavailable')));
    processHandle.once('close', () => {
      if (child !== processHandle) return;
      child = null;
      fail(new Error('harness_exited_outcome_unknown'));
      // Code security: losing the owner process does not prove its device screen was released.
      if (leaseKind === 'virtual') { connected = false; virtualOutcomeUnknown = true; virtualRecoverRequired = true; }
      else release();
    });
  }

  function fail(error) {
    if (!pending) return;
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    request.reject(error);
  }

  function send(operation, payload, onDispatch = () => {}) {
    const request = { id: randomUUID(), operation, payload };
    const line = JSON.stringify(request) + '\n';
    if (Buffer.byteLength(line) > MAX_REQUEST) throw new Error('desktop_request_too_large');
    start();
    return new Promise((resolve, reject) => {
      pending = { id: request.id, resolve, reject, timer: setTimeout(() => {
        fail(new Error('harness_timeout_outcome_unknown'));
        if (leaseKind === 'virtual') virtualOutcomeUnknown = true;
        else void stop();
      }, operation === 'replay' ? 600000 : 90000) };
      // Code security: failures before this point have not reached the device owner process.
      onDispatch();
      child.stdin.write(line);
    });
  }

  async function stop(context = {}) {
    const current = child;
    if (leaseKind === 'virtual') {
      // Code security: generic recording IPC cannot terminate an Agent-owned display.
      if (context.owner !== virtualOwner) return { success: false, error: 'virtual_owner_mismatch' };
      if (busy || pending) return { success: false, error: 'virtual_cleanup_unconfirmed' };
      try {
        const result = await request('virtual_end', {}, { owner: virtualOwner });
        return result.success && result.data?.cleanupConfirmed === true ? result
          : { success: false, error: 'virtual_cleanup_unconfirmed' };
      }
      catch { return { success: false, error: 'virtual_cleanup_unconfirmed' }; }
    }
    if (!current) { release(); return { success: true, data: { state: 'disconnected' } }; }
    // Do not release a lease before the owner process has stopped. Never resend an uncertain action.
    await new Promise(resolve => {
      const timer = setTimeout(() => current.kill('SIGKILL'), 40000);
      current.once('close', () => { clearTimeout(timer); resolve(); });
      current.kill('SIGTERM');
    });
    // Interrupted attempts may not have returned their per-run directory yet.
    if (fs.existsSync(artifactDirectory())) lastArtifacts = fs.realpathSync(artifactDirectory());
    return { success: true, data: { state: 'disconnected', interrupted: true } };
  }

  async function request(operation, payload = {}, context = {}) {
    if (!OPERATIONS.has(operation)) throw new Error('unsupported_desktop_operation');
    // Code security: reserved bridge fields can only originate in this main process.
    if (Object.prototype.hasOwnProperty.call(payload, '_desktopRunId') ||
        Object.prototype.hasOwnProperty.call(payload, '_desktopOwnerToken')) throw new Error('reserved_desktop_field');
    if (context.evidenceRunId !== undefined && (operation !== 'virtual_start' ||
        typeof context.evidenceRunId !== 'string' || !/^[0-9a-f]{32}$/.test(context.evidenceRunId)))
      throw new Error('invalid_evidence_run_id');
    if (busy) throw new Error('desktop_operation_busy');
    busy = true;
    const reserved = operation === 'connect' || operation === 'replay' || operation === 'virtual_start';
    let acquiredHere = false;
    let dispatched = false;
    try {
      if (operation.startsWith('virtual_')) {
        // Code security: the trusted Agent runtime supplies ownership, never a model argument.
        if (typeof context.owner !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(context.owner)) throw new Error('virtual_owner_required');
        if (operation !== 'virtual_start' && context.owner !== virtualOwner) throw new Error('virtual_owner_mismatch');
      }
      // Code security: an Agent-owned virtual session cannot be controlled by recording IPCs.
      if (leaseKind === 'virtual' && !operation.startsWith('virtual_')) throw new Error('virtual_session_owned');
      if (leaseKind === 'native' && operation.startsWith('virtual_')) throw new Error('native_session_owned');
      if (reserved) {
        if (connected || lease) throw new Error('disconnect_before_replay');
        const target = validateTarget(operation === 'replay' ? payload.config : payload);
        if (operation === 'virtual_start' && target.platform !== 'android') throw new Error('virtual_android_only');
        // Code security: the trusted main process owns the lease; the renderer cannot choose a session/owner ID.
        lease = gate.acquire({ id: 'desktop-control-' + randomUUID(), name: '三端设备控制',
          reservedDeviceSerials: [target.deviceId] });
        leaseKind = operation === 'virtual_start' ? 'virtual' : 'native';
        virtualOwner = operation === 'virtual_start' ? context.owner : null;
        // Code security: retain the capability only in this main process, never in renderer/model state.
        virtualRecovery = operation === 'virtual_start'
          ? { config: structuredClone(payload), ownerToken: randomBytes(32).toString('hex') } : null;
        acquiredHere = true;
        // Code security: persist the encrypted capability before the device can receive start.
        if (virtualRecovery && recoveryStore) {
          recoveryStore.save(virtualOwner, virtualRecovery);
          virtualRecoveryPersisted = true;
        }
      }
      if (operation.startsWith('virtual_') && operation !== 'virtual_start') {
        if (leaseKind !== 'virtual' || (!child && (operation !== 'virtual_end' || !virtualRecovery)))
          throw new Error('virtual_cleanup_unconfirmed');
        if (virtualOutcomeUnknown && operation !== 'virtual_end') throw new Error('virtual_outcome_unknown_cleanup_required');
      }
      // A fresh bridge may only recover cleanup for its exact retained capability; no action is replayed.
      const markDispatched = () => { dispatched = true; };
      const response = operation === 'virtual_end' && virtualRecoverRequired
        ? await send('virtual_recover', virtualRecovery, markDispatched)
        : await send(operation, operation === 'virtual_start'
          ? { ...payload, _desktopOwnerToken: virtualRecovery.ownerToken,
              ...(context.evidenceRunId === undefined ? {} : { _desktopRunId: context.evidenceRunId }) } : payload, markDispatched);
      if (operation === 'virtual_start' && context.evidenceRunId !== undefined && response.success && !response.data?.pendingReport)
        throw Error('invalid_virtual_report');
      if (operation === 'virtual_start' && response.success && response.data?.pendingReport) {
        const report = response.data.pendingReport;
        if (report.status !== 'not_tested' || report.cleanup !== 'pending' || !Array.isArray(report.checkpoints))
          throw Error('invalid_pending_virtual_report');
        report.reportPath = validateVirtualReport(artifactDirectory(), report.reportPath);
        if (context.evidenceRunId !== undefined && path.basename(path.dirname(report.reportPath)) !== 'virtual-' + context.evidenceRunId)
          throw Error('invalid_virtual_report');
      }
      if ((operation === 'connect' || operation === 'virtual_start') && response.success) connected = true;
      if (operation === 'virtual_start' && !response.success && response.cleanupPending) virtualOutcomeUnknown = true;
      if (operation === 'virtual_start' && !response.success && response.cleanupConfirmed !== true) {
        virtualOutcomeUnknown = true; response.cleanupPending = true;
      }
      if (reserved && !response.success && !(operation === 'virtual_start' && response.cleanupConfirmed !== true)
          || operation === 'replay' || operation === 'disconnect'
          || operation === 'virtual_end' && response.success && response.data?.cleanupConfirmed === true
          || response.disconnected || response.data?.state === 'completed') {
        const wasVirtual = leaseKind === 'virtual';
        // Code security: retain the encrypted capability until the confirmed result is durable.
        const pendingAck = wasVirtual && virtualRecoveryPersisted &&
          (operation === 'virtual_end' && response.success && response.data?.cleanupConfirmed === true
           || operation === 'virtual_start' && !response.success && response.cleanupConfirmed === true);
        const recordRemoved = release({ keepRecovery:pendingAck });
        if (pendingAck) response.recoveryRecordPendingAck = true;
        if (wasVirtual && !recordRemoved) response.recoveryRecordRemoved = false;
      }
      if (response.data?.artifacts) {
        // Code security: only reveal artifacts inside this controller's private root.
        const root = fs.realpathSync(artifactDirectory());
        const candidate = fs.realpathSync(response.data.artifacts);
        const relative = path.relative(root, candidate);
        if (relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) {
          lastArtifacts = candidate;
        }
      }
      return response;
    } catch (error) {
      // Stop first: even a rejected/timeout response may follow a physical action.
      if (leaseKind === 'virtual' && dispatched) virtualOutcomeUnknown = true;
      else if (dispatched && child && (acquiredHere || connected)) await stop();
      else if (acquiredHere) release();
      throw error;
    } finally {
      busy = false;
    }
  }

  async function recoverVirtual(owner) {
    if (!recoveryStore || busy) throw Error('virtual_cleanup_unconfirmed');
    if (lease && leaseKind === 'virtual' && virtualOwner === owner && virtualRecoverRequired)
      return request('virtual_end', {}, { owner });
    if (lease || connected) throw Error('virtual_cleanup_unconfirmed');
    let recovered;
    try { recovered = recoveryStore.load(owner); } catch { throw Error('virtual_recovery_unavailable'); }
    const target = validateTarget(recovered.config);
    if (target.platform !== 'android') throw Error('virtual_android_only');
    // Code security: reacquire the exact saved device before asking it to validate the owner capability.
    lease = gate.acquire({ id:'desktop-control-' + randomUUID(), name:'三端设备控制', reservedDeviceSerials:[target.deviceId] });
    leaseKind = 'virtual'; virtualOwner = owner; virtualRecovery = recovered;
    virtualRecoveryPersisted = true; virtualOutcomeUnknown = true; virtualRecoverRequired = true;
    return request('virtual_end', {}, { owner });
  }

  function acknowledgeVirtualCleanup(owner) {
    if (!recoveryStore) return true;
    try {
      // Code security: loading validates the encrypted record belongs to this conversation.
      recoveryStore.load(owner);
      recoveryStore.remove(owner);
      return true;
    } catch (error) { return error?.code === 'ENOENT'; }
  }

  return { request, stop, recoverVirtual, acknowledgeVirtualCleanup,
    ownsVirtual: owner => leaseKind === 'virtual' && virtualOwner === owner,
    artifactPath: () => lastArtifacts };
}

module.exports = { createHarnessControl, validateTarget, validateVirtualReport };
