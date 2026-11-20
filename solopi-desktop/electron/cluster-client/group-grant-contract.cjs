'use strict';
// Pure client adapter of reviewed DG119 functions (594beab helper bodies unchanged).
// No DB, approval issuance, route, or credentials. Error adapter omits Server HTTP status.
const {createHash}=require('node:crypto');
const ULID=/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,UUIDV4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,SHA=/^[0-9a-f]{64}$/;
const MAX_PAYLOAD_BYTES=262144;
const gerr=(code,message)=>Object.assign(new Error(message),{code});
function allowKeys(obj, keys, where) {
  if (!obj || Object.getPrototypeOf(obj) !== Object.prototype) throw gerr("GROUP_INVALID", where + " must be a JSON object");
  for (const k of Object.keys(obj)) if (!keys.includes(k)) throw gerr("GROUP_INVALID", `field not allowed in ${where}: ${k}`);
}
function bindingFromConsumerEnvelope(wire, outer, session) {
  // R3（7126302）：恢复wire严格对象与未知键拒绝（DG115重写时误删）——未知键（如untrustedAuthorization）不进规范化
  allowKeys(wire, ["clientId", "dispatchId", "groupId", "expectedRevision", "requestId", "payload", "payloadSha256", "payloadBytes", "dispatchPlanSha256", "memberSha256"], "consumer inbox wire");
  allowKeys(outer, ["clientId", "dispatchId", "requestId", "groupId", "expectedRevision", "memberSha256",
    "payloadSha256", "payloadBytes", "dispatchPlanSha256"], "trusted outer envelope"); // DG115：outer允许承载全binding域——可选载荷字若存在须与wire一致（不产生额外信任）
  // DG115（7125588类③）：会话必填（可信transport上下文）——省略即拒；epoch/seq归属transport注入，不由payload自证。
  if (!session || Object.getPrototypeOf(session) !== Object.prototype || !ULID.test(String(session.clientUlid ?? "")))
    throw gerr("GROUP_INVALID", "trusted session is required for normalization (wire and outer alone are not trustable)");
  if (!ULID.test(String(outer.clientId ?? ""))) throw gerr("GROUP_INVALID", "outer clientId must be ULID");
  if (outer.memberSha256 === undefined || !SHA.test(String(outer.memberSha256))) throw gerr("GROUP_INVALID", "outer memberSha256 must be authoritative sha256");
  if (session.clientUlid !== outer.clientId) throw gerr("GROUP_OWNER_MISMATCH", "envelope target must be the session owner");
  // DG115（7125588类③）+R5（7126302）：规范化即严格typed且严格域——字符串/负值/零revision在此
  // 拒绝（wire与outer同坏按规范阶段拒，不靠下游verify兜底），绝不隐式透过（先于一致性比对）。
  if (!Number.isSafeInteger(wire.expectedRevision) || wire.expectedRevision < 1) throw gerr("GROUP_INVALID", "wire expectedRevision must be integer >= 1 at normalization");
  if (!Number.isSafeInteger(wire.payloadBytes) || wire.payloadBytes < 0 || wire.payloadBytes > MAX_PAYLOAD_BYTES) throw gerr("GROUP_INVALID", "wire payloadBytes must be integer in [0," + MAX_PAYLOAD_BYTES + "] at normalization"); // DG118：补签发端同款上界（262144B），超界即拒——与签发/verify口径一致
  if (!UUIDV4.test(String(wire.requestId ?? "")) || !UUIDV4.test(String(wire.groupId ?? ""))) throw gerr("GROUP_INVALID", "wire ids must be UUIDv4");
  if (outer.expectedRevision < 1) throw gerr("GROUP_INVALID", "outer expectedRevision must be integer >= 1 (shared issue-domain)"); // 同坏revision在outer侧先拒
  // R4（7126302）：dispatchId=可信派发身份，wire与outer两侧必填且UUIDv4——不与grantId互当来源
  if (!UUIDV4.test(String(wire.dispatchId ?? "")) || !UUIDV4.test(String(outer.dispatchId ?? "")))
    throw gerr("GROUP_INVALID", "dispatchId must be present UUIDv4 on both wire and trusted outer (trusted dispatch identity)");
  if (wire.dispatchId !== outer.dispatchId) throw gerr("GROUP_EXECUTION_CONFLICT", "wire dispatchId differs from trusted outer dispatchId");
  // DG115（7125588类③）：trusted outer与wire的requestId/groupId/expectedRevision必须一致（outer三者均必填）
  for (const k of ["requestId", "groupId"]) if (outer[k] === undefined || outer[k] !== wire[k])
    throw gerr("GROUP_EXECUTION_CONFLICT", "outer " + k + " missing or differs from consumer wire");
  if (outer.expectedRevision === undefined || outer.expectedRevision !== wire.expectedRevision)
    throw gerr("GROUP_EXECUTION_CONFLICT", "outer expectedRevision missing or differs from consumer wire");
  const merged = {
    requestId: wire.requestId, clientId: outer.clientId, groupId: wire.groupId,
    expectedRevision: wire.expectedRevision,
    memberSha256: outer.memberSha256, // 权威值来自Server pending/事件外层；wire.memberSha256（若在）只作一致性检查
    payloadSha256: wire.payloadSha256, payloadBytes: wire.payloadBytes, dispatchPlanSha256: wire.dispatchPlanSha256,
  };
  for (const k of ["payloadSha256", "payloadBytes", "dispatchPlanSha256"])
    if (outer[k] !== undefined && outer[k] !== wire[k]) throw gerr("GROUP_EXECUTION_CONFLICT", "outer " + k + " differs from consumer wire");
  if (wire.clientId !== undefined && wire.clientId !== outer.clientId)
    throw gerr("GROUP_EXECUTION_CONFLICT", "consumer wire clientId does not match trusted outer clientId");
  if (wire.memberSha256 !== undefined && wire.memberSha256 !== outer.memberSha256)
    throw gerr("GROUP_EXECUTION_CONFLICT", "consumer memberSha256 differs from trusted outer");
  const body = JSON.stringify(wire.payload, (_k, x) => x && Object.getPrototypeOf(x) === Object.prototype ? Object.fromEntries(Object.keys(x).sort().map((s) => [s, x[s]])) : x);
  if (Buffer.byteLength(body, "utf8") !== wire.payloadBytes || createHash("sha256").update(body).digest("hex") !== wire.payloadSha256)
    throw gerr("GROUP_EXECUTION_CONFLICT", "payload does not match its declared digest");
  // DG115（7125588类③）：plan摘要自校验（与legacy bindingFromClientWire同款分域公式）——全零/畸形摘要在规范化即拒
  const plan = JSON.stringify({ expectedRevision: wire.expectedRevision, groupId: wire.groupId, payload: wire.payload, requestId: wire.requestId },
    (_k, x) => x && Object.getPrototypeOf(x) === Object.prototype ? Object.fromEntries(Object.keys(x).sort().map((s) => [s, x[s]])) : x);
  if (!SHA.test(String(wire.dispatchPlanSha256 ?? "")) || createHash("sha256").update(plan).digest("hex") !== wire.dispatchPlanSha256)
    throw gerr("GROUP_EXECUTION_CONFLICT", "wire does not match its declared dispatchPlanSha256");
  return merged;
}
function checkGrantVerdict(verdict, binding, session, now = Date.now()) {
  if (!session || !ULID.test(String(session.clientUlid ?? ""))) throw gerr("GROUP_INVALID", "trusted dispatch session required");
  if (!Number.isSafeInteger(now)) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "consumer clock must be a finite safe-integer instant (trusted caller parameter)"); // DG115（7125588类②）：NaN时钟不得绕过期限判断（受信参数加固）
  if (!verdict || Object.getPrototypeOf(verdict) !== Object.prototype) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict missing");
  if (verdict.authorized !== true) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict not authorized");
  if (verdict.stepProfile !== "bound-payload") throw gerr("GROUP_AUTHORIZATION_REQUIRED", "unexpected stepProfile");
  if (typeof verdict.revoked !== "boolean" || verdict.revoked !== false) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict revoked flag must be present boolean false (fail closed)"); // DG115：缺revoked关死
  if (!UUIDV4.test(String(verdict.grantId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict grantId must be present UUIDv4"); // DG115：缺grantId关死
  if (verdict.targetClientId !== session.clientUlid || verdict.targetClientId !== binding.clientId)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict target mismatch");
  // R1（7126302）：必填域核在比较前——判决与binding同缺任一必填键=undefined===undefined不得通过（fail closed）
  // R2：严格域约束与issue同口径——revision 1..MAX_SAFE_INTEGER、bytes 0..262144、三摘要sha256、
  // groupId/requestId UUIDv4、clientId ULID；不支持负/0 revision
  if (!Number.isSafeInteger(binding.expectedRevision) || binding.expectedRevision < 1)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding expectedRevision must be required integer >= 1 (shared issue-domain)");
  if (!Number.isSafeInteger(binding.payloadBytes) || binding.payloadBytes < 0 || binding.payloadBytes > MAX_PAYLOAD_BYTES)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", `binding payloadBytes must be required integer in [0,${MAX_PAYLOAD_BYTES}] (shared issue-domain)`); // DG118：补上界
  if (!UUIDV4.test(String(binding.groupId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding groupId must be required UUIDv4");
  if (!UUIDV4.test(String(binding.requestId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding requestId must be required UUIDv4");
  if (!ULID.test(String(binding.clientId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding clientId must be required ULID");
  for (const k of ["memberSha256", "payloadSha256", "dispatchPlanSha256"])
    if (!SHA.test(String(binding[k] ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "binding " + k + " must be required sha256");
  if (!Number.isSafeInteger(verdict.expectedRevision) || verdict.expectedRevision < 1)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict expectedRevision must be required integer >= 1");
  if (!Number.isSafeInteger(verdict.payloadBytes) || verdict.payloadBytes < 0 || verdict.payloadBytes > MAX_PAYLOAD_BYTES)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", `verdict payloadBytes must be required integer in [0,${MAX_PAYLOAD_BYTES}]`); // DG118：补上界
  if (!UUIDV4.test(String(verdict.groupId ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict groupId must be required UUIDv4");
  for (const k of ["memberSha256", "payloadSha256", "dispatchPlanSha256"])
    if (!SHA.test(String(verdict[k] ?? ""))) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict " + k + " must be required sha256");
  for (const [k, actual, expected] of [
    ["groupId", verdict.groupId, binding.groupId], ["expectedRevision", verdict.expectedRevision, binding.expectedRevision],
    ["memberSha256", verdict.memberSha256, binding.memberSha256], ["payloadSha256", verdict.payloadSha256, binding.payloadSha256],
    ["payloadBytes", verdict.payloadBytes, binding.payloadBytes], ["dispatchPlanSha256", verdict.dispatchPlanSha256, binding.dispatchPlanSha256],
    ["consumedByRequest", verdict.consumedByRequest, binding.requestId],
  ]) if (actual !== expected) throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict binding mismatch: " + k);
  // DG115：签发时间不得来自未来、时间区间必须正序且当前时刻在内（issuedAt<=now<expiresAt）。
  if (!Number.isSafeInteger(verdict.issuedAtMs) || !Number.isSafeInteger(verdict.expiresAtMs)
      || verdict.issuedAtMs > now || verdict.expiresAtMs <= now || verdict.issuedAtMs >= verdict.expiresAtMs)
    throw gerr("GROUP_AUTHORIZATION_REQUIRED", "verdict issuance/expiry interval invalid or expired at consumer boundary");
  return true;
}


module.exports={bindingFromConsumerEnvelope,checkGrantVerdict};
