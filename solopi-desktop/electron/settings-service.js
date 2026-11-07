const { parseCommandResultAssertions } = require('./command-result-assertions');
// Shared settings validation; persistence is owned by the single-instance broker.
const kinds = new Set(['adb','pc_command','activity','audio','image_mock','mobile_ui_action','mobile_ui_assert','tts_assert','json_assert','llm_assert']);
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function fields(value, allowed) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) throw Error('配置包含不支持的字段');
}
function httpUrl(value) { if (!['http:','https:'].includes(new URL(value).protocol)) throw Error('需要HTTP(S)地址'); }
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => /apiKey|token|password|secret|authorization|headers/i.test(key)
    ? [key, child ? '[已配置]' : ''] : [key, redact(child)]));
}
function settingsPatch(state, environment, input) {
  fields(input, ['model','selectedModelId','component','tts']);
  if (!Object.keys(input).length || (input.tts && Object.keys(input).length > 1)) throw Error('一次修改工作流配置或TTS配置，不能混合提交');
  for (const key of ['model','component','tts']) if (key in input && !plain(input[key])) throw Error(`${key}必须为配置对象`);
  const patch = {};
  if (input.model) {
    fields(input.model, ['id','name','model','baseUrl','apiKey','protocol','responseFormat','thinking']);
    if (typeof input.model.id !== 'string' || !input.model.id.trim()) throw Error('模型id必填');
    const old = (state.llmProviders || []).find(p => p.id === input.model.id);
    const model = { protocol: 'openai-compatible', apiKey: '', ...old, ...input.model };
    for (const key of ['name','model','baseUrl']) if (typeof model[key] !== 'string' || !model[key].trim()) throw Error(`模型${key}必填`);
    httpUrl(model.baseUrl);
    if (model.protocol !== 'openai-compatible' || (model.responseFormat && !['default','json_object'].includes(model.responseFormat)) || (model.thinking && !['default','disabled'].includes(model.thinking))) throw Error('模型协议或输出配置无效');
    if (input.model.apiKey !== undefined && typeof input.model.apiKey !== 'string') throw Error('apiKey必须为字符串');
    patch.llmProviders = old ? state.llmProviders.map(p => p.id === model.id ? model : p) : [...(state.llmProviders || []), model];
  }
  if (input.selectedModelId !== undefined) {
    if (!(patch.llmProviders || state.llmProviders || []).some(p => p.id === input.selectedModelId)) throw Error('默认模型不存在');
    patch.selectedLlmProviderId = input.selectedModelId;
  }
  if (input.component) {
    fields(input.component, ['id','name','description','kind','device','commandTemplate','params','timeoutSeconds','tags','resultAssertions']);
    const old = (state.components || []).find(c => c.id === input.component.id);
    const c = { ...old, ...input.component };
    if (typeof c.id !== 'string' || !c.id.trim() || typeof c.name !== 'string' || !c.name.trim() || !kinds.has(c.kind) || !['phone','glasses','pc'].includes(c.device) || typeof c.commandTemplate !== 'string' || !Array.isArray(c.params) || !Number.isFinite(c.timeoutSeconds) || c.timeoutSeconds <= 0) throw Error('组件需要id/name/kind/device/commandTemplate/params/正数timeoutSeconds');
    for (const p of c.params) {
      fields(p, ['key','label','inputType','defaultValue','placeholder','helperText','required']);
      if (typeof p.key !== 'string' || !p.key.trim() || typeof p.label !== 'string' || !['text','textarea','number','json'].includes(p.inputType) || (p.required !== undefined && typeof p.required !== 'boolean')) throw Error('组件参数需要key/label/有效inputType');
      for (const key of ['defaultValue','placeholder','helperText']) if (p[key] !== undefined && typeof p[key] !== 'string') throw Error(`参数${key}必须为字符串`);
    }
    for (const key of ['description']) if (c[key] !== undefined && typeof c[key] !== 'string') throw Error(`${key}必须为字符串`);
    if (c.tags !== undefined && (!Array.isArray(c.tags) || c.tags.some(tag => typeof tag !== 'string'))) throw Error('tags必须为字符串数组');
    if (new Set(c.params.map(p => p.key)).size !== c.params.length) throw Error('组件参数key重复');
    parseCommandResultAssertions(c.resultAssertions);
    patch.components = old ? state.components.map(x => x.id === c.id ? c : x) : [...(state.components || []), c];
  }
  if (input.tts) {
    fields(input.tts, ['enabled','name','url','method','headersText','params','bodyTemplate','responseType','responseMappings','audioField','urlField','outputExtension','sampleRate','sampleFormat','channelCnt','timeoutMs']);
    const tts = { ...(environment.ttsProvider || {}), ...input.tts };
    for (const key of ['name','url','headersText','bodyTemplate','responseType','audioField','urlField','outputExtension','sampleFormat']) if (tts[key] !== undefined && typeof tts[key] !== 'string') throw Error(`TTS ${key}必须为字符串`);
    if (tts.url) httpUrl(tts.url);
    if (tts.enabled && !tts.url) throw Error('启用TTS需要url');
    if (tts.responseType !== undefined && tts.responseType !== 'json-url') throw Error('当前TTS仅支持json-url响应');
    if (tts.enabled !== undefined && typeof tts.enabled !== 'boolean') throw Error('enabled必须为布尔值');
    if (tts.method && !['GET','POST','PUT'].includes(tts.method)) throw Error('TTS method必须为GET/POST/PUT');
    for (const key of ['sampleRate','channelCnt','timeoutMs']) if (tts[key] !== undefined && (!Number.isFinite(tts[key]) || tts[key] <= 0)) throw Error(`${key}必须为正数`);
    for (const key of ['params','responseMappings']) if (tts[key] !== undefined && !Array.isArray(tts[key])) throw Error(`${key}必须为数组`);
    for (const p of tts.params || []) { fields(p, ['key','defaultValue']); if (typeof p.key !== 'string' || !p.key.trim() || (p.defaultValue !== undefined && typeof p.defaultValue !== 'string')) throw Error('TTS参数需要key和字符串defaultValue'); }
    for (const p of tts.responseMappings || []) { fields(p, ['variableName','responsePath']); if (typeof p.variableName !== 'string' || typeof p.responsePath !== 'string' || !p.responsePath.trim()) throw Error('响应映射需要variableName/responsePath'); }
    return { environment: { ...environment, ttsProvider: tts } };
  }
  return { workflow: patch };
}
function createSettingsService({ readState, readEnvironment, writeState, writeEnvironment, applyWorkflowPatch, notifyEnvironment }) {
  return async input => {
    const state = readState() || {}, environment = readEnvironment() || {};
    if (input.operation === 'get') return { success: true, models: redact(state.llmProviders || []), selectedModelId: state.selectedLlmProviderId || '', components: redact(state.components || []), tts: redact(environment.ttsProvider || {}) };
    if (input.operation !== 'patch') throw Error('不支持的配置操作');
    const next = settingsPatch(state, environment, input.patch);
    if (input.dryRun) return { success: true, dryRun: true, changes: redact(next) };
    if (next.environment) { writeEnvironment(next.environment); notifyEnvironment?.(next.environment); }
    else {
      if (Object.entries(next.workflow).every(([k,v]) => JSON.stringify(state[k]) === JSON.stringify(v))) return { success: true, unchanged: true };
      if (applyWorkflowPatch) return applyWorkflowPatch(next.workflow, state);
      writeState({ ...state, ...next.workflow });
    }
    return { success: true };
  };
}
module.exports = { settingsPatch, createSettingsService, redact };
