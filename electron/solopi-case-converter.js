const crypto = require('node:crypto');
const {needsNativeCase,convertNativeCase,nativeCaseIssues}=require('./solopi-native-case');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_STEPS = 2000;
const ACTIONS = { click: 'CLICK', input: 'INPUT', back: 'BACK', home: 'HOME', sleep: 'SLEEP', sleepUntil: 'SLEEP_UNTIL', scrollToTop: 'SCROLL_TO_TOP', scrollToBottom: 'SCROLL_TO_BOTTOM', scrollToLeft: 'SCROLL_TO_LEFT', scrollToRight: 'SCROLL_TO_RIGHT' };
const SCROLL_DIRECTIONS = { SCROLL_TO_TOP: 'up', SCROLL_TO_BOTTOM: 'down', SCROLL_TO_LEFT: 'left', SCROLL_TO_RIGHT: 'right' };
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function parse(value, label) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { throw new Error(`${label} 不是有效 JSON`); }
}
function pendingSteps(testCase) {
  return (testCase?.steps || []).filter(step => {
    if (step?.inputs?.action === 'solopi_replay' || step?.config?.solopiNative) return nativeCaseIssues(step.inputs?.nativeCase ?? step.config?.nativeCase, step.inputs || {}).length > 0;
    return step?.config?.importReview?.required === true;
  });
}
function assertImportReviewed(testCase) {
  const pending = pendingSteps(testCase);
  if (pending.length) throw Object.assign(new Error(`SoloPi 导入仍有 ${pending.length} 个待处理节点：${pending.map(s => s.name).join('、')}`), { code: 'CASE_IMPORT_REVIEW_REQUIRED' });
}
function attachPreparation(result, options) {
  if (options.replayStart !== 'current-page') return result;
  const testCase = result.testCase, id = `${testCase.id}-prepare`;
  testCase.components.push({ id, name: '进入录制起始页面', kind: 'adb', device: 'phone', timeoutSeconds: 30,
    commandTemplate: `adb -s {{serial}} shell '${options.preparationShell}'`, params: [] });
  testCase.steps.splice(1, 0, { id, name: '进入录制起始页面', type: 'component', device: 'phone', componentId: id, inputs: {}, config: {} });
  return result;
}
function convertSoloPiCase(input, options = {}) {
  if (options.replayStart !== undefined && !['current-page', 'app-launch'].includes(options.replayStart)) throw new Error('回放启动模式无效');
  if (options.replayStart === 'current-page' && (typeof options.preparationShell !== 'string' || !options.preparationShell.trim() || options.preparationShell.length > 32768 || options.preparationShell.includes('\0'))) throw new Error('当前页面片段缺少有效前置命令');

  const encoded = typeof input === 'string' ? input : JSON.stringify(input);
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_BYTES) throw new Error('SoloPi 用例文件不能超过 10 MiB');
  let source = parse(input, 'SoloPi 用例');
  if (source?.success === true && object(source.case)) source = source.case;
  if (!object(source) || typeof source.caseName !== 'string' || !source.caseName.trim()
    || typeof source.targetAppPackage !== 'string' || !source.targetAppPackage.trim()) throw new Error('缺少 SoloPi caseName 或 targetAppPackage');
  if (!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(source.targetAppPackage.trim())) throw new Error('SoloPi targetAppPackage 不是有效 Android 包名');
  const log = parse(source.operationLog, 'operationLog');
  if (!object(log) || !Array.isArray(log.steps) || !log.steps.length || log.steps.length > MAX_STEPS) throw new Error('operationLog.steps 必须包含 1 到 2000 个操作；外置操作记录请先用 SoloPi case-get 导出完整用例');
  for(const [index,step] of log.steps.entries()) if(!object(step)||!object(step.operationMethod)||typeof step.operationMethod.actionEnum!=='string'||!object(step.operationMethod.operationParam||{})) throw Error(`第 ${index+1} 步 operationMethod/actionEnum/operationParam 无效`);
  if (needsNativeCase(source) || options.engine === 'solopi-native') {
    const result=convertNativeCase(source,options);
    result.testCase.conversionSource={type:'solopi',title:source.caseName.trim(),summary:`source SHA-256: ${crypto.createHash('sha256').update(encoded).digest('hex')}`,createdAt:new Date().toISOString()};
    return attachPreparation(result, options);
  }
  const id = `case-solopi-${crypto.randomUUID()}`;
  const issues = [];
  const components = [{ id: `${id}-ui`, name: '手机 UI 操作', kind: 'mobile_ui_action', device: 'phone', commandTemplate: '', timeoutSeconds: 10,
    params: [{ key: 'action', label: '操作类型', inputType: 'text', defaultValue: 'tap' },
      { key: 'selector', label: '元素选择器', inputType: 'json', defaultValue: '{}' },
      { key: 'inputText', label: '输入文本', inputType: 'text', defaultValue: '' },
      { key: 'matchMode', label: '定位模式', inputType: 'text', defaultValue: 'auto' },
      { key: 'allowCoordinateFallback', label: '允许坐标兜底', inputType: 'text', defaultValue: 'false' },
      { key: 'tapPosition', label: '元素内点击位置', inputType: 'text', defaultValue: 'center' },
      { key: 'tapRatioX', label: '元素内横向比例', inputType: 'text', defaultValue: '0.5' },
      { key: 'tapRatioY', label: '元素内纵向比例', inputType: 'text', defaultValue: '0.5' },
      { key: 'direction', label: '手指滑动方向', inputType: 'text', defaultValue: 'up' },
      { key: 'distancePercent', label: '滑动距离(元素百分比)', inputType: 'number', defaultValue: '100' },
      { key: 'swipeDurationMs', label: '滑动时长(ms)', inputType: 'number', defaultValue: '300' }] }];
  const steps = [{ id: `${id}-start`, name: '开始', type: 'start', device: 'phone', config: { keepScreenAwake: true } }];
  // SoloPi prepares the target application before recording; that is not an operationLog step.
  // Reuse Desktop's ordinary ADB component so replay has the same application entry.
  const launch = { id: `${id}-launch`, name: '启动录制目标应用', kind: 'adb', device: 'phone', timeoutSeconds: 30,
    commandTemplate: 'adb -s {{serial}} shell am start -S -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p {{packageName}}',
    params: [{ key: 'packageName', label: '包名', inputType: 'text', defaultValue: '${defaults.phonePackage}' }] };
  if (options.replayStart !== 'current-page') {
    components.push(launch);
    steps.push({ id: `${id}-launch`, name: '启动录制目标应用', type: 'component', device: 'phone', componentId: launch.id, inputs: { packageName: source.targetAppPackage.trim() }, config: {} });
  }
  const advanced = parse(source.advanceSettings || '{}', 'advanceSettings');
  const hasAdvanced = !object(advanced) || Object.keys(advanced).length > 0;
  log.steps.forEach((raw, index) => {
    if (!object(raw) || !object(raw.operationMethod)) throw new Error(`第 ${index + 1} 步缺少 operationMethod`);
    const method = raw.operationMethod;
    if (typeof method.actionEnum !== 'string') throw new Error(`第 ${index + 1} 步 actionEnum 无效`);
    const action = ACTIONS[method.actionEnum] || method.actionEnum;
    const params = method.operationParam || {};
    if (!object(params)) throw new Error(`第 ${index + 1} 步 operationParam 无效`);
    const node = object(raw.operationNode) ? raw.operationNode : {};
    const selector = {};
    for (const [from, to] of [['resourceId', 'resourceId'], ['text', 'text'], ['description', 'contentDesc']]) {
      if (typeof node[from] === 'string' && node[from].trim()) { selector[to] = node[from]; break; }
    }
    const bound = node.nodeBound;
    const geometryOnly = (action === 'CLICK' || SCROLL_DIRECTIONS[action]) && !Object.keys(selector).length && typeof node.className === 'string' && bound && ['left','top','right','bottom'].every(key => Number.isFinite(bound[key])) && bound.right > bound.left && bound.bottom > bound.top;
    if (geometryOnly) { selector.className = node.className; selector.bounds = `[${bound.left},${bound.top}][${bound.right},${bound.bottom}]`; }
    const step = { id: `${id}-${index + 1}`, name: `${index + 1}. ${action}`, type: 'wait', device: 'phone', config: { durationMs: 0, solopiSource: { index, action } } };
    let reason = '';
    const relative = params.localClickPos === undefined ? null : String(params.localClickPos).split(',').map(value => value.trim() === '' ? NaN : Number(value));
    const validRelative = !relative || (relative.length === 2 && relative.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    if (method.encrypt === true || method.safeEncrypt === true) reason = '加密操作无法读取，需手动重建；原始参数未复制';
    else if (Object.values(params).some(v => typeof v === 'string' && v.includes('${'))) reason = '含 SoloPi 动态变量，需转换变量语义';
    else if (SCROLL_DIRECTIONS[action]) {
      const distance = params.text === undefined || params.text === '' ? 100 : /^\+?\d+$/.test(String(params.text)) ? Number(params.text) : NaN;
      if (!Object.keys(selector).length) reason = '元素滑动缺少可定位的选择器或有效区域';
      else if (Object.keys(params).some(key => !['text', 'localClickPos'].includes(key)) || !validRelative || !Number.isInteger(distance) || distance <= 0 || distance > 10000) reason = '元素滑动方向、距离、起点或额外参数需要核对';
      else {
        step.type = 'component'; step.componentId = components[0].id;
        step.name = `${index + 1}. 元素内${{ up: '上滑', down: '下滑', left: '左滑', right: '右滑' }[SCROLL_DIRECTIONS[action]]} · ${distance}%`;
        step.config = { ...step.config, action: 'swipe_element', selector, direction: SCROLL_DIRECTIONS[action], distancePercent: distance, swipeDurationMs: 300, tapPosition: 'relative', tapRatioX: relative?.[0] ?? 0.5, tapRatioY: relative?.[1] ?? 0.5, ...(geometryOnly ? { matchMode: 'bounds' } : {}) };
      }
    }
    else if (['CLICK', 'INPUT', 'SLEEP_UNTIL'].includes(action)) {
      if (!Object.keys(selector).length) reason = '缺少可等价转换的元素选择器（不将 XPath/坐标静默降级）';
      else if (Object.keys(params).some(key => !['text', 'localClickPos'].includes(key))) reason = '包含额外操作参数，需确认点击位置、输入方式或等待语义';
      else if (!validRelative) reason = '录制的元素内点击比例无效，需重新选择点击位置';
      else if (action === 'SLEEP_UNTIL') reason = 'SoloPi 等待条件需手动核对，不能仅替换为元素存在';
      else {
        step.type = 'component'; step.componentId = components[0].id;
        step.config = { ...step.config, action: action === 'INPUT' ? 'input' : 'tap', selector };
        if (geometryOnly) step.config.matchMode = 'bounds';
        if (relative) { step.config.tapPosition = 'relative'; step.config.tapRatioX = relative[0]; step.config.tapRatioY = relative[1]; }
        if (action === 'CLICK') step.name = `${index + 1}. 点击 · ${String(node.text || node.description || node.resourceId || '录制区域（严格定位）').slice(0, 60)}`;
        if (action === 'INPUT') {
          // Recorded input can contain credentials. No original input value enters the generated case.
          step.config.selector = node.resourceId ? { resourceId: node.resourceId } : {};
          step.config.inputText = '';
          reason = '输入内容已移除；请填写输入文本/变量并核对选择器和输入方式';
        }
      }
    } else if (action === 'BACK' || action === 'HOME') {
      if (Object.keys(params).length) reason = '按键动作含额外参数，需手动核对';
      else { step.type = 'component'; step.componentId = components[0].id; step.config.action = action.toLowerCase(); }
    } else if (action === 'SLEEP') {
      const duration = Number(params.text);
      if (params.text === undefined || !Number.isFinite(duration) || duration < 0 || duration > 900000 || Object.keys(params).some(k => k !== 'text')) reason = '等待时长或参数无效';
      else step.config.durationMs = duration;
    } else reason = '暂不支持等价转换此操作；请替换为 desktop 节点（未执行原始脚本或忽略操作）';
    if (hasAdvanced && index === 0) reason = [reason, '原用例含 advanceSettings，需核对初始化、参数及运行语义'].filter(Boolean).join('；');
    if (reason) {
      step.config.importReview = { required: true, reason };
      step.name += ' · 待处理'; issues.push({ stepId: step.id, index, action, reason });
    }
    if (step.type === 'component') {
      step.inputs = { action: step.config.action, selector: JSON.stringify(step.config.selector || {}), inputText: String(step.config.inputText || ''), allowCoordinateFallback: 'false', ...(step.config.matchMode ? { matchMode: step.config.matchMode } : {}), ...(step.config.tapPosition ? { tapPosition: step.config.tapPosition, tapRatioX: String(step.config.tapRatioX), tapRatioY: String(step.config.tapRatioY) } : {}), ...(step.config.action === 'swipe_element' ? { direction: step.config.direction, distancePercent: String(step.config.distancePercent), swipeDurationMs: String(step.config.swipeDurationMs) } : {}) };
      delete step.config.action; delete step.config.selector; delete step.config.inputText;
    }
    steps.push(step);
  });
  steps.push({ id: `${id}-end`, name: '结束', type: 'end', device: 'phone', config: {} });
  return attachPreparation({ testCase: { schemaVersion: 'glassbox.workflow.v1', id, name: source.caseName.trim(), folderId: options.folderId,
    description: '由 SoloPi 操作记录转换；请检查节点与业务断言后运行。', reviewStatus: 'draft', tags: ['solopi-import', 'draft'],
    conversionSource: { type: 'solopi', title: source.caseName.trim(), summary: `source SHA-256: ${crypto.createHash('sha256').update(encoded).digest('hex')}`, createdAt: new Date().toISOString() },
    defaults: { phonePackage: source.targetAppPackage.trim(), ...(options.phoneSerial ? { phoneSerial: options.phoneSerial } : {}) }, components, steps },
    issues, operationCount: log.steps.length, runnable: issues.length === 0, addsBusinessAssertions: false }, options);
}
module.exports = { convertSoloPiCase, assertImportReviewed, pendingSteps, MAX_BYTES };
