const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const Ajv = require('ajv');
const { documentSchema, assertPreservedStepFields } = require('./case-contract');
const validate = new Ajv({ strict: false }).compile(documentSchema);
function caseRevision(state, id) {
  const c = state.cases?.find(c => c.id === id);
  if (!c) throw Error(`用例不存在：${id}`);
  return createHash('sha256').update(JSON.stringify({ case: c, edges: state.caseEdges?.[id] })).digest('hex');
}
function checkRevision(state, payload) {
  if (payload.expectedRevision && caseRevision(state, payload.caseId) !== payload.expectedRevision) throw Error(`用例 ${payload.caseId} 已变更，请重新导出并合并修改；未覆盖新版本。`);
}
function exportDocument(state,id) {
  const c=require('../case-assets').withAssetContext(state,state.cases.find(c=>c.id===id));
  const document=Object.fromEntries(Object.entries(c).filter(([key])=>Object.hasOwn(documentSchema.properties,key)));
  if(state.caseEdges?.[id])document.edges=state.caseEdges[id];
  return document;
}
async function exportCases(state, caseIds, {allowedPaths}={}) {
  if (!caseIds.length || new Set(caseIds).size !== caseIds.length) throw Error('caseIds不能为空或重复');
  const updates = caseIds.map(caseId => {
    const expectedRevision = caseRevision(state, caseId);
    const document = exportDocument(state,caseId);
    return { caseId, expectedRevision, document };
  });
  if(allowedPaths)require('./edit-scope').assertScope({}, {}, allowedPaths);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'solopi-desktop-case-batch-'));
  const filePath = path.join(dir, 'cases.json');
  await fs.writeFile(filePath, JSON.stringify({ version: allowedPaths ? 2 : 1, updates }, null, 2), { mode: 0o600 });
  if(allowedPaths)await fs.writeFile(filePath+'.scope.json',JSON.stringify({allowedPaths,caseIds}),{mode:0o400});
  return { success: true, filePath, allowedPaths, count: updates.length, message: '使用run_command脚本修改此文件的updates[].document，保留caseId/expectedRevision及未修改字段；然后save_cases_from_file一次提交。不要直接编辑运行中的用例库存储文件。' };
}
async function saveCasesFromFile({ filePath, dryRun = false }, { readState, saveCase, signal }) {
  if (!path.isAbsolute(filePath)) throw Error('filePath必须是绝对路径');
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw Error('批量文件必须是50MB以内的JSON文件');
  const batch = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (![1,2].includes(batch.version) || !Array.isArray(batch.updates) || !batch.updates.length) throw Error('需要export_cases导出的version=1或2和非空updates数组');
  let scope;
  try{scope=JSON.parse(await fs.readFile(filePath+'.scope.json','utf8'));}catch(error){if(error.code!=='ENOENT'||batch.version===2)throw Error('编辑范围记录不可读，请重新导出；未写入用例');}
  const changedFields={};
  const ids = new Set(); const payloads = []; const unchanged=[];
  for (const item of batch.updates) {
    if (!item || typeof item.caseId !== 'string' || ids.has(item.caseId)) throw Error('用例ID缺失或重复');
    ids.add(item.caseId);
    if(scope&&!scope.caseIds.includes(item.caseId))throw Error('用例不属于导出时的编辑范围');
    if (!/^[a-f0-9]{64}$/.test(item.expectedRevision || '')) throw Error('缺少导出时的expectedRevision');
    if (!validate(item.document)) throw Error(`用例 ${item.caseId} 文档不合法：${JSON.stringify(validate.errors)}`);
    if (item.document.id !== item.caseId) throw Error('document.id必须与caseId一致');
    const payload = { action: 'update-case', caseId: item.caseId, expectedRevision: item.expectedRevision, document: item.document };
    const state = readState(); checkRevision(state, payload);
    // Compare the exact JSON export projection, after checking its revision.
    // Do not guess that a partial patch is equivalent to a full document.
    if(isDeepStrictEqual(item.document,JSON.parse(JSON.stringify(exportDocument(state,item.caseId))))){unchanged.push(item.caseId);continue;}
    changedFields[item.caseId]=require('./edit-scope').assertScope(JSON.parse(JSON.stringify(exportDocument(state,item.caseId))),item.document,scope?.allowedPaths);
    assertPreservedStepFields(state.cases.find(c => c.id === item.caseId), item.document, state.components || []);
    require('./case-contract').assertLogSampleExtraction(state,{...state.cases.find(c=>c.id===item.caseId),...item.document},state.cases.find(c=>c.id===item.caseId));
    payloads.push(payload);
  }
  const changedIds=payloads.map(payload=>payload.caseId);
  // Validate every changed case through the real editor path before the first write.
  for (const payload of payloads) {
    signal?.throwIfAborted();
    const result = await saveCase({ ...payload, dryRun: true });
    if (!result?.success) return { success: false, phase: 'validate', caseId: payload.caseId, result, saved: [], unchanged, remaining: changedIds };
  }
  if (dryRun) return { success: true, dryRun: true, count: payloads.length, selectedCount:ids.size, changedFields, saved: [], unchanged };
  const saved = [];
  for (const payload of payloads) {
    try {
      signal?.throwIfAborted();
      checkRevision(readState(), payload);
      const result = await saveCase(payload);
      if (!result?.success) return { success: false, phase: 'save', caseId: payload.caseId, result, saved, unchanged, remaining: changedIds.filter(id => !saved.includes(id)) };
      saved.push(payload.caseId);
    } catch (error) { return { success: false, phase: 'save', error: error.message, saved, unchanged, remaining: changedIds.filter(id => !saved.includes(id)) }; }
  }
  return { success: true, count: saved.length, selectedCount:ids.size, changedFields, saved, unchanged };
}
module.exports = { caseRevision, checkRevision, exportCases, saveCasesFromFile };
