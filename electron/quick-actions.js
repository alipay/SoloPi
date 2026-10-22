const fs = require('fs');
const path = require('path');

const SUPPORTED_QUICK_ACTION_EXTENSIONS = new Set(['.sh', '.ps1', '.cmd', '.bat']);
const INPUT_TYPES = new Set(['text', 'number', 'boolean', 'select', 'file', 'directory', 'multiline']);

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (String(value).toLowerCase() === 'true') return true;
  if (String(value).toLowerCase() === 'false') return false;
  return fallback;
}

function normalizeInput(raw, index) {
  const key = String(raw?.key || `arg${index + 1}`).trim().replace(/[^a-zA-Z0-9_.-]/g, '');
  const type = INPUT_TYPES.has(raw?.type) ? raw.type : 'text';
  return {
    key: key || `arg${index + 1}`,
    label: String(raw?.label || key || `参数 ${index + 1}`).trim(),
    type,
    required: parseBoolean(raw?.required),
    defaultValue: raw?.defaultValue == null ? '' : String(raw.defaultValue),
    placeholder: raw?.placeholder == null ? '' : String(raw.placeholder),
    options: Array.isArray(raw?.options) ? raw.options.map((option) => {
      if (option && typeof option === 'object') {
        const value = String(option.value ?? '').trim();
        return value ? { label: String(option.label || value).trim(), value } : null;
      }
      const value = String(option ?? '').trim();
      return value ? { label: value, value } : null;
    }).filter(Boolean) : [],
  };
}

function parseEmbeddedMetadata(content) {
  const definition = { inputs: [], args: [] };
  const lines = String(content || '').split(/\r?\n/).slice(0, 120);
  for (const line of lines) {
    const match = line.match(/^\s*(?:#|REM\s+)\s*@glassbox-([a-z-]+)\s+(.+?)\s*$/i);
    if (!match) continue;
    const [, field, rawValue] = match;
    if (field === 'name') definition.name = rawValue;
    if (field === 'description') definition.description = rawValue;
    if (field === 'timeout') definition.timeoutSeconds = Number(rawValue);
    if (field === 'arg') definition.args.push(rawValue);
    if (field === 'param') {
      const [key, label, type, required, defaultValue = '', options = ''] = rawValue.split('|');
      definition.inputs.push(normalizeInput({
        key,
        label,
        type,
        required,
        defaultValue,
        options: options ? options.split(',').map((item) => item.trim()) : [],
      }, definition.inputs.length));
    }
  }
  return definition;
}

function inferScriptDefinition(content, extension) {
  if (extension === '.ps1') {
    const parameterBlock = String(content || '').match(/\bparam\s*\(([\s\S]*?)\)/i)?.[1] || '';
    const matches = [...parameterBlock.matchAll(/(?:\[\s*(string|int|long|double|switch|bool|boolean)\s*\]\s*)?\$([a-zA-Z_][\w-]*)/gi)];
    const inputs = matches.map((match, index) => normalizeInput({
      key: match[2],
      label: match[2],
      type: /^(?:int|long|double)$/i.test(match[1] || '')
        ? 'number'
        : /^(?:switch|bool|boolean)$/i.test(match[1] || '') ? 'boolean' : 'text',
    }, index));
    return {
      inputs,
      args: inputs.flatMap((input) => input.type === 'boolean'
        ? [`-${input.key}:{{inputs.${input.key}}}`]
        : [`-${input.key}`, `{{inputs.${input.key}}}`]),
    };
  }

  const expression = extension === '.cmd' || extension === '.bat'
    ? /%([1-9]\d*)/g
    : /\$(?:\{(\d+)[^}]*\}|(\d+))/g;
  const indexes = [...String(content || '').matchAll(expression)]
    .map((match) => Number(match[1] || match[2]))
    .filter((value) => Number.isInteger(value) && value > 0);
  const maximum = indexes.length ? Math.max(...indexes) : 0;
  const inputs = Array.from({ length: maximum }, (_, index) => normalizeInput({
    key: `arg${index + 1}`,
    label: `参数 ${index + 1}`,
    required: true,
  }, index));
  return { inputs, args: inputs.map((input) => `{{inputs.${input.key}}}`) };
}

function readQuickActionDefinition(scriptPath) {
  const absolutePath = path.resolve(String(scriptPath || ''));
  const extension = path.extname(absolutePath).toLowerCase();
  if (!SUPPORTED_QUICK_ACTION_EXTENSIONS.has(extension)) {
    throw new Error('仅支持 .sh、.ps1、.cmd 和 .bat 脚本');
  }
  if (!fs.statSync(absolutePath).isFile()) throw new Error('选择的脚本不是文件');

  const content = fs.readFileSync(absolutePath, 'utf8');
  const embedded = parseEmbeddedMetadata(content);
  const raw = embedded;
  const inferred = inferScriptDefinition(content, extension);
  const hasEmbeddedMetadata = Boolean(raw.name || raw.description || raw.inputs.length || raw.args.length);
  const inputs = Array.isArray(raw.inputs) && raw.inputs.length ? raw.inputs.map(normalizeInput) : inferred.inputs;
  const args = Array.isArray(raw.args) && raw.args.length
    ? raw.args.map(String)
    : inferred.inputs === inputs ? inferred.args : inputs.map((input) => `{{inputs.${input.key}}}`);

  return {
    name: String(raw.name || path.basename(absolutePath, extension)).trim(),
    description: String(raw.description || '在当前电脑执行脚本').trim(),
    scriptPath: absolutePath,
    metadataSource: hasEmbeddedMetadata ? 'script-comments' : 'positional-arguments',
    detectedInputCount: inferred.inputs.length,
    inputs,
    args,
    queryConfig: raw.queryConfig && typeof raw.queryConfig === 'object' ? {
      enabled: parseBoolean(raw.queryConfig.enabled),
      showOnCard: parseBoolean(raw.queryConfig.showOnCard),
      args: Array.isArray(raw.queryConfig.args) ? raw.queryConfig.args.map(String) : [],
      resultPath: String(raw.queryConfig.resultPath || '').trim(),
      targetInputKey: String(raw.queryConfig.targetInputKey || '').trim(),
      rerunAfterExecute: parseBoolean(raw.queryConfig.rerunAfterExecute),
    } : null,
    timeoutSeconds: Math.min(3600, Math.max(1, Number(raw.timeoutSeconds) || 30)),
  };
}

function resolveTemplate(value, inputs, context) {
  return String(value).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key) => {
    if (key.startsWith('inputs.')) {
      const inputKey = key.slice('inputs.'.length);
      return Object.prototype.hasOwnProperty.call(inputs, inputKey) ? String(inputs[inputKey] ?? '') : whole;
    }
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key] ?? '') : whole;
  });
}

function resolveQuickActionArguments(action, inputValues = {}, context = {}) {
  const values = resolveQuickActionInputValues(action, inputValues, context);
  return (action.args || []).map((argument) => resolveTemplate(argument, values, context));
}

function resolveQuickActionInputValues(action, inputValues = {}, context = {}) {
  const values = {};
  for (const input of action.inputs || []) {
    const rawValue = input.userInput !== false && Object.prototype.hasOwnProperty.call(inputValues, input.key)
      ? inputValues[input.key]
      : input.defaultValue;
    const resolved = resolveTemplate(rawValue == null ? '' : rawValue, inputValues, context);
    if (input.required && (!String(resolved).trim() || /\{\{[^}]+\}\}/.test(String(resolved)))) {
      throw new Error(input.userInput === false ? `隐藏参数“${input.label}”未获得有效默认值，请检查设备选择或在快捷操作设置中修改默认值` : `请填写${input.label}`);
    }
    values[input.key] = resolved;
  }
  return values;
}

function buildQuickActionExecution(action, platform = process.platform) {
  const extension = path.extname(action.scriptPath).toLowerCase();
  if (extension === '.sh') {
    if (platform === 'win32') throw new Error('Windows 请为该快捷操作选择 .ps1、.cmd 或 .bat 脚本');
    return { command: '/bin/bash', prefixArgs: [action.scriptPath] };
  }
  if (extension === '.ps1') {
    return {
      command: platform === 'win32' ? 'powershell.exe' : 'pwsh',
      prefixArgs: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', action.scriptPath],
    };
  }
  if (extension === '.cmd' || extension === '.bat') {
    if (platform !== 'win32') throw new Error('当前系统不能执行 Windows CMD 脚本');
    return { command: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', action.scriptPath] };
  }
  throw new Error('不支持的快捷操作脚本类型');
}

module.exports = {
  SUPPORTED_QUICK_ACTION_EXTENSIONS,
  buildQuickActionExecution,
  parseEmbeddedMetadata,
  readQuickActionDefinition,
  resolveQuickActionArguments,
  resolveQuickActionInputValues,
  resolveTemplate,
};
