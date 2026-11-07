// The Agent sees observations and opaque target IDs; only the UI receives image bytes.
function createVirtualTools({ control, controlConfig, preview, timers = globalThis }) {
  const owners = new Map();
  const empty = { type: 'object', properties: {}, additionalProperties: false };
  const appSchema = { type: 'object', properties: { packageName: { type: 'string', minLength: 3, maxLength: 200,
    pattern: '^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)+$' } }, required: ['packageName'], additionalProperties: false };
  const actionSchema = { type: 'object', properties: { observationId: { type: 'string', minLength: 1, maxLength: 160 },
    targetId: { type: 'string', pattern: '^((node|ocr)-[1-9][0-9]*|viewport-1)$' }, action: { enum: ['click', 'scroll'] },
    direction: { enum: ['up', 'down', 'left', 'right'] } }, required: ['observationId', 'targetId', 'action'], additionalProperties: false };
  function device(session, packageName) {
    const serial = session.screenDevice?.serial;
    if (session.screenDevice?.runtime !== 'android') throw Error('后台屏幕仅支持顶部选择的 Android 手机');
    if (typeof serial !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(serial)) throw Error('请先在桌面顶部选择 Android 手机');
    const setting = controlConfig();
    if (!setting || typeof setting.packageName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(setting.packageName)
        || !Number.isInteger(setting.port) || setting.port < 1024 || setting.port > 65535) throw Error('SoloPi 控制服务配置无效');
    return { platform: 'android', deviceId: serial, deviceKind: serial.startsWith('emulator-') ? 'simulator' : 'physical',
      appId: packageName, controlPackage: setting.packageName, controlPort: setting.port };
  }
  function markUnavailable(session, state) {
    if (!state.stopping && !state.previewUnavailable) {
      state.previewUnavailable = true;
      preview(session.id, { screenMode: 'virtual', state: 'unavailable' });
    }
  }
  function publishFrame(session, image, displayId, ocrState) {
    const state = owners.get(session.id);
    if (!state || state.stopping) return;
    if (state.staleTimer) timers.clearTimeout(state.staleTimer);
    state.previewUnavailable = false;
    preview(session.id, { screenMode: 'virtual', displayId, image, state: 'active',
      ...(ocrState ? { ocrState } : {}) });
    // Measure age since the last delivered frame even while an action occupies the channel.
    state.staleTimer = timers.setTimeout(() => markUnavailable(session, state), 5000);
    state.staleTimer.unref?.();
  }
  function resultForModel(session, result) {
    const descriptions = {
      virtual_protected_or_blank_frame: '后台画面受保护或全黑，已停止。',
      virtual_protected_or_blank_target: '目标区域受保护或全黑，已拒绝操作。',
      virtual_protected_or_blank_after_dispatch: '动作已提交，但后续画面受保护或全黑，结果无法确认；停止并核对，不能重复操作。',
      virtual_action_outcome_unconfirmed: '上一次动作结果未确认；当前会话只能观察和清理，不能继续发送动作。',
      virtual_settle_unconfirmed: '动作已提交，但页面在规定时间内未稳定，结果无法确认；停止并核对，不要重复操作。',
      virtual_target_on_main: '动作已提交，副屏窗口不可见且同一应用在主屏活动；任务已停止，请检查手机，不要重复操作。',
      virtual_display_geometry_changed: '后台屏幕方向或尺寸已变化，本次观察不可用；请结束任务并重新开始。',
      virtual_initial_window_unavailable: '后台屏幕初始窗口不可用，任务已停止。',
      virtual_initial_frame_unavailable: '后台屏幕初始画面不可用，任务已停止。',
      virtual_initial_observation_unstable: '后台屏幕初始画面或页面未稳定，任务已停止。',
      virtual_initial_observation_stale: '后台屏幕初始观察已过期，任务已停止。',
    };
    if (!result?.success || !result.data) return { success: false, errorCode: result?.error || 'virtual_request_failed',
      error: descriptions[result?.error] || result?.error || 'virtual_request_failed',
      ...(result?.cleanupPending ? { cleanupPending: true } : {}),
      ...(result?.cleanupConfirmed === true ? { cleanupConfirmed:true } : {}) };
    const { screenshotDataUrl, pendingReport, ...observation } = result.data;
    // This local artifact belongs to the desktop session, not the model context.
    if (pendingReport) session.screenReport = pendingReport;
    // Code security: never place screenshot bytes in model messages, history or diagnostics.
    if (typeof screenshotDataUrl === 'string' && screenshotDataUrl.startsWith('data:image/png;base64,'))
      publishFrame(session, screenshotDataUrl, observation.displayId,
        observation.ocrError === 'ocr_unavailable' ? 'unavailable'
          : observation.ocrError ? 'degraded' : observation.ocrFreshness === 'current' ? 'ready'
            : observation.ocrFreshness ? 'degraded' : 'unknown');
    return { success: true, ...observation, screenshotAvailable: typeof screenshotDataUrl === 'string' };
  }
  function requireOwner(session) {
    if (!owners.has(session.id)) throw Error('当前对话没有副屏会话');
  }
  async function waitPreview(session) {
    const running = owners.get(session.id)?.previewPromise;
    if (running) await running.catch(() => {});
  }
  async function finish(session) {
    if (!owners.has(session.id)) {
      // Recovery clears ownerActive: an absent in-memory owner after restart is
      // not evidence that a previously created device screen was released.
      if (session.screenCleanup?.confirmed === false && session.screenCleanup?.ownerActive !== true) {
        const lastStart = (session.calls || []).filter(call => call.name === 'virtual_start').at(-1);
        if (lastStart?.status === 'failed' && lastStart.result?.cleanupConfirmed === true) {
          // Code security: this persisted receipt precedes every later start, which has its own ledger entry.
          if (!session.screenReport) session.screenReport = { status:'not_tested', reportPath:null, checkpoints:[] };
          return { success:true, cleanupConfirmed:true,
            ...(typeof control.acknowledgeVirtualCleanup === 'function'
              ? { acknowledge:() => control.acknowledgeVirtualCleanup(session.id) } : {}) };
        }
        if (typeof control.recoverVirtual !== 'function')
          return { success: false, cleanupConfirmed: false, error: 'virtual_owner_lost_cleanup_unconfirmed' };
        const recovered = await control.recoverVirtual(session.id);
        if (!recovered?.success || recovered.data?.cleanupConfirmed !== true)
          return { success: false, cleanupConfirmed: false, error: 'virtual_cleanup_unconfirmed' };
        session.screenReport = { ...(session.screenReport || { status:'not_tested', reportPath:null, checkpoints:[] }),
          recoveryCleanupConfirmed: true, ...(recovered.recoveryRecordRemoved === false ? { recoveryRecordRemovalFailed:true } : {}) };
        return { success: true, cleanupConfirmed: true,
          ...(recovered.recoveryRecordPendingAck ? { acknowledge: () => control.acknowledgeVirtualCleanup(session.id) } : {}),
          recoveryRecordRemoved: recovered.recoveryRecordRemoved !== false };
      }
      if (!session.screenReport && session.screenChecks?.length)
        session.screenReport = { status: 'not_tested', reportPath: null,
          checkpoints: session.screenChecks.map(() => ({ status: 'not_tested', reason: 'screen_not_started' })) };
      return { success: true, cleanupConfirmed: true };
    }
    const state = owners.get(session.id);
    if (state.startFailureCleaned) {
      owners.delete(session.id);
      if (!session.screenReport) session.screenReport = { status:'not_tested', reportPath:null, checkpoints:[] };
      return { success:true, cleanupConfirmed:true,
        ...(state.recoveryRecordPendingAck ? { acknowledge:() => control.acknowledgeVirtualCleanup(session.id) } : {}) };
    }
    state.stopping = true;
    if (state.timer) timers.clearInterval(state.timer);
    if (state.staleTimer) timers.clearTimeout(state.staleTimer);
    if (state.previewPromise) await state.previewPromise.catch(() => {});
    const result = await control.request('virtual_end', { completed: session.status === 'idle' }, { owner: session.id });
    if (!result?.success || result.data?.cleanupConfirmed !== true) return { success: false, cleanupConfirmed: false, error: 'virtual_cleanup_unconfirmed' };
    owners.delete(session.id);
    if (result.data.report) session.screenReport = result.data.report;
    else if (result.data.recovered && session.screenReport)
      session.screenReport = { ...session.screenReport, recoveryCleanupConfirmed: true };
    if (result.recoveryRecordRemoved === false)
      session.screenReport = { ...(session.screenReport || { status:'not_tested', reportPath:null, checkpoints:[] }), recoveryRecordRemovalFailed:true };
    preview(session.id, { screenMode: 'virtual', state: 'closed', cleanupConfirmed: true });
    return { success: true, cleanupConfirmed: true,
      ...(result.recoveryRecordPendingAck ? { acknowledge: () => control.acknowledgeVirtualCleanup(session.id) } : {}) };
  }
  function startPreview(session) {
    const state = owners.get(session.id);
    state.timer = timers.setInterval(() => {
      if (state.stopping || state.previewPromise) return;
      state.previewPromise = control.request('virtual_preview', {}, { owner: session.id }).then(result => {
        if (result?.success && typeof result.data?.screenshotDataUrl === 'string'
            && result.data.screenshotDataUrl.startsWith('data:image/png;base64,'))
          publishFrame(session, result.data.screenshotDataUrl, result.data.displayId);
        else markUnavailable(session, state);
      }).catch(error => {
        // Busy usually means an action is still running; the frame-age timer handles it.
        if (error?.message !== 'desktop_operation_busy') markUnavailable(session, state);
      }).finally(() => { state.previewPromise = null; });
    }, 1000);
    state.timer.unref?.();
  }
  function tools(session) {
    return [
      { name: 'virtual_list_apps', description: '只读查询当前选中的 Android 手机上已安装的应用包名，供副屏启动时准确选择。', schema: empty,
        execute: async () => { const config = device(session, controlConfig().packageName); const r = await control.request('apps', config); return r.success ? { success: true, ...r.data } : { success: false, error: r.error }; } },
      { name: 'virtual_start', description: '在本任务专属副屏打开指定 Android 应用，返回当前节点和手机本地 OCR 候选；不允许转到主屏。', schema: appSchema, confirm: true,
        execute: async args => {
          if (owners.has(session.id)) throw Error('副屏会话已启动，请先观察');
          const config = { ...device(session, args.packageName), fixedChecks: (session.screenChecks || []).map(c=>({...c})) }; owners.set(session.id, { config });
          try {
            const result = await control.request('virtual_start', config, { owner: session.id });
            if (!result.success && result.cleanupConfirmed === true) {
              const state = owners.get(session.id);
              state.startFailureCleaned = true;
              state.recoveryRecordPendingAck = result.recoveryRecordPendingAck === true;
            } else if (!result.success && !result.cleanupPending) owners.delete(session.id);
            if (result.success) startPreview(session);
            return resultForModel(session, result);
          } catch (error) { if (!control.ownsVirtual(session.id)) owners.delete(session.id); throw error; }
        } },
      { name: 'virtual_observe', description: '重新读取本任务副屏节点与本地 OCR。只使用返回的新 observationId 和候选 ID。', schema: empty,
        execute: async () => { requireOwner(session); await waitPreview(session); return resultForModel(session, await control.request('virtual_observe', {}, { owner: session.id })); } },
      { name: 'virtual_act', description: '使用当前观察的目标 ID 执行一次点击或滚动。OCR 目标仅可点击；无节点页面若提供 viewport-1，可上下滚动。设备会重新核验；失败或结果未知不可自动重发。', schema: actionSchema, confirm: true,
        execute: async args => { requireOwner(session); await waitPreview(session); return resultForModel(session, await control.request('virtual_act', args, { owner: session.id })); } },
    ];
  }
  return { tools, finish, owns: id => owners.has(id), ownedIds: () => [...owners.keys()] };
}
module.exports = { createVirtualTools };
