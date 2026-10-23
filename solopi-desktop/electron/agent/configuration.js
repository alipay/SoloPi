const { randomUUID } = require('node:crypto');
function mergeConfiguration(state, input) {
  const patch = {};
  if (input.deviceBindings) {
    const d = input.deviceBindings;
    const allowed = ['phoneSerials','glassesSerials','phoneDefaultPackage','glassesDefaultPackage'];
    if (Object.keys(d).some(k => !allowed.includes(k))) throw Error('未知设备设置字段');
    for (const key of ['phoneDefaultPackage','glassesDefaultPackage']) if (d[key] !== undefined && (typeof d[key] !== 'string' || !/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(d[key]))) throw Error('默认包名需要完整应用包名，请先查询设备安装包，不能猜测简称');
    for (const key of ['phoneSerials','glassesSerials']) if (d[key] !== undefined && (!Array.isArray(d[key]) || d[key].some(v => typeof v !== 'string' || !v.trim()))) throw Error('设备SN必须是非空字符串数组');
    patch.deviceBindings = {...state.deviceBindings, ...d};
    if ((patch.deviceBindings.phoneSerials || []).some(s => (patch.deviceBindings.glassesSerials || []).includes(s))) throw Error('同一SN不能同时固定为手机和眼镜');
  }
  if (input.model) {
    const m = input.model;
    if (m.apiKey !== undefined) throw Error('密钥请在设置中心安全表单填写，不要发送到聊天');
    if (Object.keys(m).some(k => !['id','name','model','baseUrl'].includes(k))) throw Error('模型仅接受id/name/model/baseUrl');
    if (!m.id || !m.name || !m.model || !m.baseUrl || !['https:', 'http:'].includes(new URL(m.baseUrl).protocol)) throw Error('模型配置需要id、名称、模型和HTTP(S)地址');
    const old = (state.llmProviders || []).find(p => p.id === m.id);
    patch.llmProviders = [...(state.llmProviders || []).filter(p => p.id !== m.id), { ...old, ...m }];
  }
  if (input.selectedModelId) {
    if (!(patch.llmProviders || state.llmProviders || []).some(p => p.id === input.selectedModelId)) throw Error('模型不存在');
    patch.selectedLlmProviderId = input.selectedModelId;
  }
  if (input.component) {
    const c = input.component;
    if (!c.id || !c.name || !['adb','pc_command','activity','audio','image_mock','mobile_ui_action','mobile_ui_assert','tts_assert','json_assert','llm_assert'].includes(c.kind) || !['phone','glasses','pc'].includes(c.device) || typeof c.commandTemplate !== 'string' || !Array.isArray(c.params) || !Number.isFinite(c.timeoutSeconds) || c.timeoutSeconds <= 0) throw Error('组件需要id/name/kind/device/commandTemplate/params/正数timeoutSeconds，按现有组件格式填写');
    if (!['create','update'].includes(input.action)) throw Error('组件修改需要action=create或update');
    if (input.action === 'create' && (state.components || []).some(x => x.id === c.id)) throw Error('组件id已存在');
    if (input.action !== 'create' && !(state.components || []).some(x => x.id === c.id)) throw Error('待修改组件不存在');
    patch.components = [...(state.components || []).filter(x => x.id !== c.id), { ...(state.components || []).find(x => x.id === c.id), ...c }];
  }
  if (!Object.keys(patch).length) throw Error('没有配置变更');
  return patch;
}
// Persist through the current editor so stale renderer state cannot overwrite changes.
function createConfigurationBridge({ readState, sender, pending, timeoutMs = 10000, preparePatch = mergeConfiguration }) {
  return async input => {
    const state = readState();
    const patch = preparePatch(state, input);
    if (Object.entries(patch).every(([k, v]) => JSON.stringify(state[k]) === JSON.stringify(v))) return { success: true, unchanged: true };
    const target = sender();
    if (!target || target.isDestroyed()) throw Error('配置需要当前编辑器在线，请打开solopi-desktop');
    const requestId = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(requestId); resolve({ success: false, error: '配置保存未收到编辑器确认，请先核对当前状态' }); }, timeoutMs);
      pending.set(requestId, { resolve, timer, sender: target });
      try { target.send('agent:configuration-update', { requestId, patch }); }
      catch (error) { clearTimeout(timer); pending.delete(requestId); resolve({ success: false, error: error.message }); }
    });
  };
}
module.exports = { mergeConfiguration, createConfigurationBridge };
