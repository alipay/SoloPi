const fs = require('fs');
const path = require('path');

function readObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('根节点必须是 JSON 对象');
    return value;
  } catch (error) {
    throw new Error(`Config 不是有效 JSON：${error.message}`);
  }
}

function writeObject(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function setValue(target, keyPath, value) {
  const parts = String(keyPath).split('.').filter(Boolean);
  if (!parts.length) throw new Error('缺少 Config 字段路径');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) current[part] = {};
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function deleteValue(target, keyPath) {
  const parts = String(keyPath).split('.').filter(Boolean);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) return;
    current = current[part];
  }
  delete current[parts.at(-1)];
}

function main(argv) {
  const [command, filePath, ...args] = argv;
  if (!command || !filePath) throw new Error('用法：quick-action-helper <validate|set|delete> <json-file> [...args]');
  const config = readObject(filePath);
  if (command === 'validate') return;
  if (command === 'set') {
    const [keyPath, rawValue, valueType = 'string'] = args;
    const value = valueType === 'json' ? JSON.parse(rawValue) : rawValue;
    setValue(config, keyPath, value);
    writeObject(filePath, config);
    return;
  }
  if (command === 'delete') {
    args.forEach((keyPath) => deleteValue(config, keyPath));
    writeObject(filePath, config);
    return;
  }
  throw new Error(`未知命令：${command}`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
