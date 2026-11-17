// SoloPi Lab Server — stage A request/response schema enforcement (C8 R2 / C9 R2)
// 采用成熟依赖 Ajv2020（Draft2020-12全量关键字，含嵌套JSON Pointer $ref解析；SCHEMA锚定contracts/v0.1.6）
// + ajv-formats（date-time真实日历/UTC校验）；strict编译失败即抛错，未知/未解析引用不得静默通过。
// 手写"零运行时依赖"子集校验器已于C9裁决撤下——依赖取舍正式变更为固定版本（package.json精确锁版）。
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// C101（7116276切片兼容缺口修复）：全局锚点**回退至v0.3.9**（operator候选链既定锚，C100一度整体切至
// v0.4.0被裁为"全局切锚点改变旧合同"——在无operator组切片（现网核心字节+组增量）里，旧Agent端点会按
// v0.4.0的agent.schema(min1)校验，与保留核心的30秒下界(min30)行为不一致）。修订为**按端点绑定独立解析**：
// 裸文件名ref恒解析到锚点目录（旧合同行为零变化）；显式版本前缀`vX.Y.Z/<file>.json#/...`才解析到
// contracts/vX.Y.Z/schemas——组端点用此前缀指向v0.4.0冻结组schema，与旧Agent边界互不夹带。
// 可选SOLOPI_SCHEMA_DIR（默认不设置=零行为变化）：无operator切片重建时把锚点指到切片自带的核心contracts
// （现网核心30s下界validator原样生效），组ref仍按v0.4.0版本前缀解析——切片与候选链两不干扰。
const bundledRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractRoot = existsSync(join(bundledRoot, 'contracts')) ? bundledRoot : join(bundledRoot, '..');
const DEFAULT_SCHEMA_DIR = join(contractRoot, "contracts", "v0.3.9", "schemas"); // v0.3.9=operator候选链既定锚（与C100前的链内实际一致）
const SCHEMA_DIR = process.env.SOLOPI_SCHEMA_DIR || DEFAULT_SCHEMA_DIR;
const CONTRACTS_ROOT = join(contractRoot, "contracts");
const schemaDirFor = (versionPrefix) => versionPrefix ? join(CONTRACTS_ROOT, versionPrefix, "schemas") : SCHEMA_DIR;
const ajv = new Ajv2020({ strict: true, allErrors: true }); // strict: 未知关键字/非法Schema/未解析$ref编译即报错
addFormats(ajv); // date-time: 真实日历（2026-11-31、2026-02-29(平年)拒绝）
const compiled = new Map();

// 预载全部Schema文档（作为具名根），引用按文件内/$defs/嵌套指针完整解析
const files = readFileSync(join(SCHEMA_DIR, "endpoint-bindings.json"), "utf8");
const allRefs = new Set();
for (const ep of JSON.parse(files).endpoints) {
  if (ep.request) allRefs.add(ep.request);
  for (const code in ep.success ?? {}) if (/^\d+$/.test(code)) allRefs.add(ep.success[code]);
}
const docIds = new Map();
// C102（7116473）：同$id异内容被吞修复——注册前核内容一致。分隔符稳定串行化（键排序）作为内容指纹，
// 同$id同内容=合法复用（冻结链逐字节副本）；同$id异内容=显式报错拒绝（不静默套用旧validator）。
const idContents = new Map(); // $id -> canonical serialization
function canonicalOf(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalOf).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalOf(value[k])).join(",") + "}";
}
function loadDoc(nameMatch) {
  if (docIds.has(nameMatch)) return docIds.get(nameMatch);
  // C101：nameMatch可带版本前缀（"v0.4.0/group-registration.schema.json"）——锚点按前缀独立解析；
  // C102：同$id注册前先核内容一致（同值复用、异值拒绝）。
  const m2 = /^(v[0-9]+\.[0-9]+\.[0-9]+)\//.exec(nameMatch);
  const dir = schemaDirFor(m2 ? m2[1] : null);
  const fileName = m2 ? nameMatch.slice(m2[0].length) : nameMatch;
  const doc = JSON.parse(readFileSync(join(dir, fileName), "utf8"));
  if (!doc.$id) throw new Error("schema missing $id: " + nameMatch);
  const canon = canonicalOf(doc);
  const prior = idContents.get(doc.$id);
  if (prior !== undefined) {
    if (prior !== canon)
      throw new Error("schema $id content conflict: " + doc.$id + " requested as \"" + nameMatch + "\" differs from already-registered copy with same $id (refusing silent validator reuse); use a distinct $id per content");
    docIds.set(nameMatch, doc.$id);
    return doc.$id; // 同$id同内容=合法复用（Ajv已注册等价副本），不重复注册
  }
  let added = false;
  try { ajv.addSchema(doc); added = true; } catch (e) {
    if (!/already registered|already exists|duplicate/i.test(String(e?.message ?? e))) throw e;
    // Ajv已注册同$id（例如本进程此前从未经loadDoc注册过该$id的等价副本）——内容一致性仍守住：
    // 无指纹时不可证明同值，按异值处理显式拒绝，不静默套用旧validator。
    throw new Error("schema $id already registered outside validator registry: " + doc.$id + " (" + nameMatch + "); refusing silent reuse without content proof");
  }
  void added;
  idContents.set(doc.$id, canon);
  docIds.set(nameMatch, doc.$id);
  return doc.$id;
}
// 启动即编译全部绑定目标（fail-fast：任一Schema非法/引用未解析则在加载时抛错，不静默放行）
for (const ref of allRefs) getValidator(ref);
export const boundRefs = [...allRefs];

function getValidator(refString) {
  if (compiled.has(refString)) return compiled.get(refString);
  const m = /^((v[0-9]+\.[0-9]+\.[0-9]+\/)?([A-Za-z0-9._-]+\.json))#(.+)$/.exec(refString);
  if (!m) throw new Error("bad ref (not a schema pointer): " + refString);
  const baseId = loadDoc(m[1]); // m[1]=带可选版本前缀的文件名（loadDoc内自解析锚点/前缀目录）
  const v2 = ajv.compile({ $ref: baseId + "#" + m[4] }); // 嵌套JSON Pointer解析；未解析引用在此刻抛错
  compiled.set(refString, v2);
  return v2;
}

// 返回null（合法）或错误消息数组（调用方422/500使用）；不存在"静默不校验"路径
export function validateRef(refString, value) {
  const v = getValidator(refString);
  const ok = v(value);
  if (ok) return null;
  return v.errors.map((e) => `${e.instancePath || "/"}:${e.keyword}`.slice(0, 120));
}
