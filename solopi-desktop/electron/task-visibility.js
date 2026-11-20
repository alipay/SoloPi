const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const development=require(fs.existsSync(path.join(__dirname,'development-tasks.cjs'))?'./development-tasks.cjs':'./development-tasks');
const protocol = 'lenswiper.task-visibility.v1';
const removalIds = require(fs.existsSync(path.join(__dirname,'task-removal-index.cjs'))?'./task-removal-index.cjs':'./task-removal-index').createTaskRemovalIndex();
const identity=require(fs.existsSync(path.join(__dirname,'product-identity.cjs'))?'./product-identity.cjs':'./product-identity');
function defaultUiDataDir({platform=process.platform,home=os.homedir(),env=process.env}={}) {
  if (env.LENSWIPER_TASK_UI_DATA_DIR) return path.resolve(env.LENSWIPER_TASK_UI_DATA_DIR);
  const appData=platform==='darwin'?path.join(home,'Library','Application Support'):platform==='win32'?env.APPDATA||path.join(home,'AppData','Roaming'):env.XDG_CONFIG_HOME||path.join(home,'.config');
  return identity.defaultDataDirectory(appData);
}

function canonical(dir) { return fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir); }
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function enableTaskVisibility(uiDir) { atomic(path.join(uiDir, 'task-visibility.json'), { protocol }); }
function assertTaskVisibility(dataDir, uiDir = defaultUiDataDir()) {
  if (canonical(dataDir) === canonical(uiDir)) return { mode: 'shared', uiDataDir: uiDir };
  let capability;
  try { capability = JSON.parse(fs.readFileSync(path.join(uiDir, 'task-visibility.json'), 'utf8')); } catch {}
  if (capability?.protocol !== protocol) throw Object.assign(new Error('当前 UI 尚不支持隔离任务同步，请先安装并打开新版 solopi-desktop；任务未提交。'), { code: 'TASK_UI_VISIBILITY_UNAVAILABLE' });
  // Fail before executing anything if the index cannot be written.
  const directory = path.join(uiDir, 'external-tasks');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.accessSync(directory, fs.constants.W_OK);
  return { mode: 'indexed', uiDataDir: uiDir };
}
function recordPath(uiDir, id) { return path.join(uiDir, 'external-tasks', crypto.createHash('sha256').update(String(id)).digest('hex') + '.json'); }
function registerTaskSource(dataDir, uiDir = defaultUiDataDir()) {
  if (canonical(dataDir) === canonical(uiDir)) return;
  const key = crypto.createHash('sha256').update(canonical(dataDir)).digest('hex');
  atomic(path.join(uiDir, 'task-sources', key + '.json'), { protocol, dataDir: canonical(dataDir) });
}
function publishVisibleTask(dataDir, task, uiDir = defaultUiDataDir()) {
  if(development.workspace(dataDir))development.registerWorkspace(dataDir,uiDir);
  if(readRemovedTaskIds(dataDir).includes(task.id))return {mode:'removed',taskId:task.id};
  const visibility = assertTaskVisibility(dataDir, uiDir);
  if (visibility.mode === 'shared') return visibility;
  registerTaskSource(dataDir, uiDir);
  const file = recordPath(uiDir, task.id);
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (canonical(previous.externalSource.dataDir) !== canonical(dataDir)) throw new Error('TASK_ID_SOURCE_CONFLICT');
  }
  atomic(file, { ...task, externalSource: { dataDir: canonical(dataDir), ownerPid: process.pid }, uiVisibility: visibility,
    reportDetailPath: task.reportDetailPath || file, reportDetailLoaded: task.reportDetailPath ? false : true });
  return visibility;
}
function readVisibleTasks(uiDir, {includeDevelopment=true}={}) {
  const removed=new Set(readRemovedTaskIds(uiDir));
  for(const sourceKind of ['task-sources','development-workspaces']){
  const sources = path.join(uiDir, sourceKind);
  if (fs.existsSync(sources)) for (const name of fs.readdirSync(sources).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(sources, name), 'utf8'));
      const managed=sourceKind==='development-workspaces'?development.workspace(entry.dataDir):null;
      if (sourceKind==='development-workspaces' ? !managed || canonical(managed.sourceDataDir)!==canonical(uiDir) : entry.protocol!==protocol) continue;
      if(canonical(entry.dataDir)===canonical(uiDir))continue;
      const state = JSON.parse(fs.readFileSync(path.join(entry.dataDir, 'workflow-editor-state.json'), 'utf8'));
      for (const summary of state.automationTasks || []) {
        if (!summary.id || removed.has(summary.id) || (!includeDevelopment && (development.isDevelopmentTask(summary)||development.workspace(entry.dataDir)))) continue;
        const target = recordPath(uiDir, summary.id);
        const current = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
        if (current?.visibilityDeleted || (current && Date.parse(current.updatedAt || current.createdAt) >= Date.parse(summary.updatedAt || summary.createdAt))) continue;
        const detail = summary.reportDetailPath;
        const task = summary;
        publishVisibleTask(entry.dataDir, task, uiDir);
      }
    } catch { /* Keep the last known record if a source has moved or is temporarily unavailable. */ }
  }
  }
  const dir = path.join(uiDir, 'external-tasks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).flatMap(name => {
    try {
      const file = path.join(dir, name), task = JSON.parse(fs.readFileSync(file, 'utf8'));
      if(removed.has(task.id) && !task.visibilityDeleted)atomic(file,{...task,visibilityDeleted:true});
      if(!includeDevelopment && (development.isDevelopmentTask(task)||development.workspace(task.externalSource?.dataDir || uiDir)))return [];
      return task.id && !removed.has(task.id) && task.externalSource?.dataDir && !task.visibilityDeleted ? [{ ...task, reportDetailPath: task.reportDetailPath || file, reportDetailLoaded: task.reportDetailPath !== file ? false : true }] : [];
    } catch { return []; } // Atomic updates; one damaged record must not hide all other tasks.
  });
}
function getVisibleTask(uiDir, id) { return readVisibleTasks(uiDir).find(task => task.id === id); }
function deleteVisibleTask(uiDir, id) {
  const task = getVisibleTask(uiDir, id);
  if (!task) return false;
  if (['submitted', 'running', 'stopping'].includes(task.status)) throw new Error('请先停止任务，再删除报告');
  atomic(recordPath(uiDir, id), { ...task, visibilityDeleted: true });
  return true;
}
function readRemovedTaskIds(dataDir){
 const dirs=new Set([canonical(dataDir)]),sourceDir=path.join(dataDir,'task-sources');
 if(fs.existsSync(sourceDir))for(const name of fs.readdirSync(sourceDir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){try{const s=JSON.parse(fs.readFileSync(path.join(sourceDir,name),'utf8'));if(s.protocol===protocol)dirs.add(canonical(s.dataDir));}catch{}}
 const ids=new Set();for(const dir of dirs)for(const id of removalIds(path.join(dir,'workflow-editor-state.json')))ids.add(id);
 const cached=path.join(dataDir,'external-tasks');if(fs.existsSync(cached))for(const name of fs.readdirSync(cached).filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){try{const task=JSON.parse(fs.readFileSync(path.join(cached,name),'utf8'));if(task.visibilityDeleted)ids.add(task.id);}catch{}}
 return [...ids];
}
module.exports = { getDevelopmentWorkspace:development.workspace, visibleTaskSummaries:development.visibleTasks, readRemovedTaskIds, defaultUiDataDir, registerTaskSource, enableTaskVisibility, assertTaskVisibility, publishVisibleTask, readVisibleTasks, getVisibleTask, deleteVisibleTask };
