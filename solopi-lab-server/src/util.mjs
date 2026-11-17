// SoloPi Lab Server — stage A utils (ULID, time, hashing, contract errors)
import { randomBytes, scryptSync, createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, createPublicKey, createPrivateKey } from "node:crypto";

// Code security: ULID 使用 CSPRNG 尾部随机数；时间取单调递增高位，保证同毫秒可排序
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = 0;
export function ulid(nowMs = Date.now()) {
  if (nowMs < 0 || nowMs > 281474976710655) throw new Error("time out of ulid range");
  let t = nowMs;
  const timePart = [];
  for (let i = 0; i < 10; i++) { timePart.push(ULID_ALPHABET[t % 32]); t = Math.floor(t / 32); }
  let s = timePart.reverse().join("");
  const rnd = randomBytes(16);
  for (let i = 0; i < 16; i++) s += ULID_ALPHABET[rnd[i] & 31];
  if (t !== 0) throw new Error("ulid time overflow");
  return s;
}
export const SAFE_MAX = 9007199254740991; // 2^53-1: contracts v0.1.4 §0.7 对外整数上界

export function toRfc3339(ms) {
  if (ms === null || ms === undefined) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
export function fromRfc3339(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/.exec(s);
  if (!m) return null;
  const ms = Date.parse(s);
  return Number.isInteger(ms) ? ms : null;
}

// -- tokens & hashing --------------------------------------------------------
export function newToken() { return randomBytes(32).toString("base64url"); } // CSPRNG only

export function tokenHash(token, salt) {
  // Code security: scrypt(N=16384) — contracts §0.6：库中只存 salt+scrypt 哈希，不存明文
  return scryptSync(token, Buffer.from(salt, "base64"), 64, { N: 16384, r: 8, p: 1 }).toString("base64");
}
export function sha256b64(data) { return createHash("sha256").update(data).digest("base64"); }
export function sha256b64url(buf) { return createHash("sha256").update(buf).digest("base64url"); }

// -- signatures (contracts §1.5/§2.1) ---------------------------------------
export function generateClientKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }), privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) };
}
export function signChallenge(pemPrivate, purpose, challenge) {
  return cryptoSign(null, Buffer.from(purpose + "|" + challenge, "utf8"), createPrivateKey(pemPrivate));
}
export function verifyChallenge(pemPublic, purpose, challenge, signatureB64) {
  try {
    return cryptoVerify(null, Buffer.from(purpose + "|" + challenge, "utf8"), createPublicKey(pemPublic), Buffer.from(signatureB64, "base64"));
  } catch { return false; }
}
export function publicKeyFingerprint(pemPublic) {
  return "sha256:" + sha256b64url(createPublicKey(pemPublic).export({ type: "spki", format: "der" }));
}

// -- errors (contracts §4) --------------------------------------------------
export const EC = {
  VALIDATION_FAILED: 422, AUTH_REQUIRED: 401, AUTH_TOKEN_INVALID: 401,
  AUTH_CHALLENGE_EXPIRED: 401, AUTH_REVOKED: 401, AUTH_SCOPE_DENIED: 403,
  ENROLL_NOT_FOUND: 404, CLIENT_NOT_FOUND: 404,
  SESSION_EPOCH_CONFLICT: 409, ENROLL_ALREADY_DECIDED: 409, ENROLL_KEY_ROTATION_CONFLICT: 409,
  RESOURCE_BUSY: 409, ENROLL_RECOVERY_KEY_MISMATCH: 422,
  SNAPSHOT_CONFLICT: 409, DEVICE_IDENTITY_CONFLICT: 409, SNAPSHOT_SEQ_GAP: 422, // v0.2.0设备子集（合同§4错误码扩展）
  MEDIA_SESSION_INVALID: 422, MEDIA_TICKET_INVALID: 401, // v0.2.0媒体数据面r3（增量合同§4）
  AGENT_TASK_INVALID: 422, AGENT_TASK_CONFLICT: 409, // v0.3.0 Agent任务面（增量合同§4）
  // C98（DG1接线，合同v0.4.0§6冻结映射）：组注册/执行投影面GROUP_*错误码——此前仅模块gerr抛出，
  // EC缺省500系；接线路由正式返回401/403/409/422语义
  GROUP_INVALID: 422, GROUP_REGISTRATION_CONFLICT: 409, GROUP_REVISION_CONFLICT: 409,
  GROUP_DUPLICATE_MEMBER: 422, GROUP_OWNER_MISMATCH: 403, GROUP_NOT_FOUND: 422,
  GROUP_DELETED: 422, GROUP_RUNNER_UNSUPPORTED: 422, GROUP_DEVICE_IDENTITY_MISMATCH: 422,
  GROUP_DEVICE_OFFLINE: 422, GROUP_BUSY: 409, GROUP_EXECUTION_CONFLICT: 409,
  GROUP_EXECUTION_NOT_FOUND: 422, GROUP_STOP_REQUESTED: 409,
  GROUP_RECONCILIATION_REQUIRED: 409, GROUP_PAYLOAD_OUTSIDE_SNAPSHOT: 422,
  GROUP_PROJECTION_INVALID_TRANSITION: 422,
  // DG120（授权HTTP接线）：授权面GROUP_*错误码——f47430e已审模块gerr抛出，EC映射入路由语义
  GROUP_AUTHORIZATION_REQUIRED: 403, GROUP_GRANT_IMMUTABLE: 409,
  RATE_LIMITED: 429, INTERNAL: 500, UNAVAILABLE: 503,
};
export const ERROR_CODE_ENUM = [
  "VALIDATION_FAILED", "AUTH_REQUIRED", "AUTH_TOKEN_INVALID",
  "AUTH_CHALLENGE_EXPIRED", "AUTH_REVOKED", "AUTH_SCOPE_DENIED",
  "ENROLL_NOT_FOUND", "CLIENT_NOT_FOUND", "TASK_NOT_FOUND",
  "SESSION_EPOCH_CONFLICT", "ENROLL_KEY_ROTATION_CONFLICT",
  "ENROLL_ALREADY_DECIDED", "CMD_DIGEST_CONFLICT", "RESOURCE_BUSY",
  "ENROLL_RECOVERY_KEY_MISMATCH", "SNAPSHOT_CONFLICT", "SNAPSHOT_SEQ_GAP",
  "DEVICE_IDENTITY_CONFLICT", "MEDIA_SESSION_INVALID", "MEDIA_TICKET_INVALID",
  "AGENT_TASK_INVALID", "AGENT_TASK_CONFLICT",
  // C98（DG1接线）：v0.4.0§6冻结GROUP错误码入枚举
  "GROUP_INVALID", "GROUP_REGISTRATION_CONFLICT", "GROUP_REVISION_CONFLICT", "GROUP_DUPLICATE_MEMBER",
  "GROUP_OWNER_MISMATCH", "GROUP_NOT_FOUND", "GROUP_DELETED", "GROUP_RUNNER_UNSUPPORTED",
  "GROUP_DEVICE_IDENTITY_MISMATCH", "GROUP_DEVICE_OFFLINE", "GROUP_BUSY", "GROUP_EXECUTION_CONFLICT",
  "GROUP_EXECUTION_NOT_FOUND", "GROUP_STOP_REQUESTED", "GROUP_RECONCILIATION_REQUIRED",
  "GROUP_PAYLOAD_OUTSIDE_SNAPSHOT", "GROUP_PROJECTION_INVALID_TRANSITION",
  "RATE_LIMITED", "INTERNAL", "UNAVAILABLE",
];
export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.status = EC[code] ?? 500;
    this.extra = extra;
  }
  body(retryable = false) {
    const err = { code: this.code, message: this.message, retryable };
    if (this.extra && Object.keys(this.extra).length) err.details = this.extra;
    if (this.code === "RATE_LIMITED" && this.extra?.retryAfterSec) err.retryAfterSec = this.extra.retryAfterSec;
    return { error: err };
  }
}
export const vErr = (msg, extra) => new ApiError("VALIDATION_FAILED", msg, extra);
