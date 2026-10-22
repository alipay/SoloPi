const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function validateRepository(repoUrl, branch = '', directory = '') {
  if (typeof repoUrl !== 'string' || /[\r\n\0]/.test(repoUrl) || repoUrl.startsWith('-')) throw new Error('请输入 HTTPS 或 SSH Git 仓库地址');
  if (/^https:\/\//.test(repoUrl) || /^ssh:\/\//.test(repoUrl)) {
    const url = new URL(repoUrl);
    if (url.password || url.search || url.hash || (url.protocol === 'https:' && url.username)) throw new Error('请使用系统 Git 凭据，不要在仓库地址中填写密码或 Token');
  } else if (!/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(repoUrl)) throw new Error('仅支持 HTTPS、SSH 仓库地址');
  if (typeof branch !== 'string' || branch.startsWith('-') || /[\s\0]/.test(branch)) throw new Error('分支名称无效');
  if (typeof directory !== 'string' || path.isAbsolute(directory) || directory.includes('\\') || directory.split('/').some((part) => part === '..' || part.toLowerCase() === '.git') || /[\0\r\n]/.test(directory)) throw new Error('脚本目录必须是仓库内的相对路径');
  return { repoUrl, branch, directory: directory.replace(/^\.\//, '').replace(/\/$/, '') };
}

async function importGitScripts({ root, repoUrl, branch, directory, run, readDefinition, getActions, saveActions, platform = process.platform }) {
  const source = validateRepository(repoUrl, branch, directory);
  const sourceKey = crypto.createHash('sha256').update(JSON.stringify(source)).digest('hex');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  // Immutable snapshots: failed pulls and running sessions never lose their old scripts.
  const snapshot = fs.mkdtempSync(path.join(root, 'snapshot-'));
  const checkout = path.join(snapshot, 'repo');
  const hooks = path.join(snapshot, 'empty-hooks');
  fs.mkdirSync(hooks);
  await run('git', ['-c', `core.hooksPath=${hooks}`, 'clone', '--template=', ...(branch ? ['--branch', branch] : []), '--depth', '1', '--', repoUrl, checkout]);
  const scanRoot = path.join(checkout, source.directory);
  // Refuse symlinks both in the configured directory and in discovered files.
  let current = checkout;
  for (const part of source.directory.split('/').filter(Boolean)) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('脚本目录不能是符号链接'); }
  if (!fs.statSync(scanRoot).isDirectory()) throw new Error('脚本目录不存在');
  const extensions = platform === 'win32' ? ['.ps1', '.cmd', '.bat'] : ['.sh', '.ps1'];
  const files = [];
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > 30) throw new Error('脚本目录层级过深，请缩小扫描目录');
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 20000 || files.length > 500) throw new Error('仓库文件过多，请指定脚本子目录');
      if (entry.isSymbolicLink() || ['.git', 'node_modules'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  };
  walk(scanRoot, 0);
  if (!files.length) throw new Error('该目录没有适用于当前系统的脚本');
  const definitions = files.map((file) => {
    const metadataPath = `${file}.lenswiper.json`;
    let config = {};
    if (fs.existsSync(metadataPath)) {
      if (fs.lstatSync(metadataPath).isSymbolicLink()) throw new Error('快捷操作配置不能是符号链接');
      const data = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (data.schemaVersion !== 'lenswiper.quick-action.v1') throw new Error('快捷操作配置版本不支持');
      config = portableConfig(data);
      config = { ...config, configuredInputs: config.inputs, argsOverride: config.args, userConfigured: true };
    }
    return { definition: { ...readDefinition(file), ...config }, relativePath: path.relative(checkout, file).split(path.sep).join('/') };
  });
  // Read after the network operation, so unrelated settings edits are preserved.
  const actions = getActions();
  for (const { definition, relativePath } of definitions) {
    const index = actions.findIndex((action) => action.gitSource?.key === sourceKey && action.gitSource.relativePath === relativePath);
    const existing = index >= 0 ? actions[index] : null;
    const action = {
      ...existing, ...definition,
      configuredInputs: existing?.configuredInputs ?? definition.configuredInputs,
      argsOverride: existing?.argsOverride ?? definition.argsOverride,
      sessionConfig: existing?.sessionConfig ?? definition.sessionConfig,
      name: existing?.name || definition.name,
      description: existing?.description || definition.description,
      inputs: existing?.configuredInputs || definition.inputs,
      args: existing?.argsOverride || definition.args,
      queryConfig: existing?.queryConfig || definition.queryConfig,
      id: existing?.id || crypto.randomUUID(), showInToolbar: existing ? existing.showInToolbar !== false : false,
      gitSource: { ...source, key: sourceKey, relativePath }, updatedAt: new Date().toISOString(),
    };
    if (index >= 0) actions[index] = action; else actions.push(action);
  }
  // Missing remote files are retained on their previous snapshot, never silently deleted.
  saveActions(actions);
  return { success: true, count: definitions.length, actions };
}
function portableConfig(action) {
  if (!Array.isArray(action.inputs) || !Array.isArray(action.args)) throw new Error('快捷操作参数配置无效');
  return { name: String(action.name || ''), description: String(action.description || ''),
    inputs: action.inputs, args: action.args, queryConfig: action.queryConfig || null,
    sessionConfig: action.sessionConfig || null };
}

async function exportGitScript({ root, repoUrl, branch, directory, action, run }) {
  const source = validateRepository(repoUrl, branch, directory);
  if (!source.branch) throw new Error('上传必须填写目标分支');
  const config = portableConfig(action);
  const scriptPath = action.scriptPath;
  if (!scriptPath || !fs.statSync(scriptPath).isFile()) throw new Error('本地脚本不存在');
  const extension = path.extname(scriptPath).toLowerCase();
  if (!['.sh', '.ps1', '.cmd', '.bat'].includes(extension)) throw new Error('脚本类型不支持');
  const content = fs.readFileSync(scriptPath);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const snapshot = fs.mkdtempSync(path.join(root, 'upload-'));
  fs.writeFileSync(path.join(snapshot, '.metadata_never_index'), '');
  const checkout = path.join(snapshot, 'repo');
  const hooks = path.join(snapshot, 'empty-hooks');
  fs.mkdirSync(hooks);
  const git = (...args) => run('git', ['-c', `core.hooksPath=${hooks}`, ...args]);
  try {
    await git('clone', '--template=', '--branch', source.branch, '--depth', '1', '--', source.repoUrl, checkout);
    let target = checkout;
    for (const part of source.directory.split('/').filter(Boolean)) {
      target = path.join(target, part);
      if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isDirectory())) throw new Error('上传目录不能是符号链接或文件');
      fs.mkdirSync(target, { recursive: true });
    }
    const previous = action.gitSource;
    const reusePath = previous?.repoUrl === source.repoUrl && previous.branch === source.branch
      && path.posix.dirname(previous.relativePath || '') === (source.directory || '.');
    const filename = reusePath ? path.posix.basename(previous.relativePath)
      : `action-${crypto.createHash('sha256').update(String(action.id)).digest('hex').slice(0, 16)}${extension}`;
    if (!filename || filename === '.' || filename === '..') throw new Error('脚本文件名无效');
    const destination = path.join(target, filename);
    const metadata = `${destination}.lenswiper.json`;
    for (const file of [destination, metadata]) if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('上传目标不能是符号链接');
    fs.writeFileSync(destination, content, { mode: 0o755 });
    fs.writeFileSync(metadata, JSON.stringify({ schemaVersion: 'lenswiper.quick-action.v1', ...config }, null, 2) + '\n');
    const relativePath = path.relative(checkout, destination).split(path.sep).join('/');
    await git('-C', checkout, 'add', '--', relativePath, `${relativePath}.lenswiper.json`);
    const diff = await git('-C', checkout, 'diff', '--cached', '--name-only');
    if (!String(diff.stdout || '').trim()) return { success: true, unchanged: true, relativePath };
    await git('-C', checkout, '-c', 'commit.gpgsign=false', 'commit', '-m', `Update quick action: ${config.name}`);
    await git('-C', checkout, 'push', 'origin', `HEAD:refs/heads/${source.branch}`);
    return { success: true, relativePath };
  } finally { fs.rmSync(snapshot, { recursive: true, force: true }); }
}
module.exports = { validateRepository, importGitScripts, exportGitScript, portableConfig };
