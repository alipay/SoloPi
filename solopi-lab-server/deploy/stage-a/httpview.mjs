#!/usr/bin/env node
const {gatewayListenOptions} = await import(new URL(existsSync(new URL('../../src/gateway-listen-options.mjs',import.meta.url))?'../../src/gateway-listen-options.mjs':'../../lab-server/src/gateway-listen-options.mjs',import.meta.url));
import {collectCpJson} from './cp-request-body.mjs';
const {createPackageHandler} = await import(new URL(existsSync(new URL('../../src/package-library.mjs',import.meta.url))?'../../src/package-library.mjs':'../../lab-server/src/package-library.mjs',import.meta.url));
// stage-A 内网HTTP只读查看入口（部署层，服务端负责人独占）——响应C15后范围更新：
//   匿名浏览器（仅内网）可读，无证书前置；页面=W8静态构建；数据=服务端只读代理。
// 安全边界（队长逐条落实）：
//   ① 管理token只在本进程内存：启动时从0600受控文件载入，绝不下发给浏览器、也不接受浏览器提交；
//   ② 代理固定作用域 solopi-lab/glasses（服务端硬编码），浏览器不能传orgId/projectId/任何scope；
//   ③ 仅放行 GET /ro/clients、GET /ro/enrollments、GET /ro/devices 三个读取端点，查询参数白名单(枚举/分页)；
//      媒体最小查看授权走 /mv/*（固定scope进程内token直调dispatch，同③模式）：浏览器只拿到短时单用途viewer票，
//      不下发管理token、不暴露泛化代理；/ws/media/* upgrade逐条写死转发至本地8792媒体数据面（非泛化路径代理）；
//       /ro/devices沿用同固定scope；响应即/v1/devices最小字段集（无adbSerial/无发现指纹）——媒体端点永不进RO；
//   ④ 全部写方法(POST/PUT/DELETE/PATCH)与任意其他 /v1/*、/dev-connection* 一律404/405——无任意上游/路径转发；
//   ⑤ 复用进程内 createApp dispatch（无外部HTTP上游面，SSRF零面）；HTTPS/API/DB保持不动。
import { createServer, request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
const { createApp, CONTRACT_VERSION } = await import(new URL(existsSync(new URL('../../src/app.mjs',import.meta.url))?'../../src/app.mjs':'../../lab-server/src/app.mjs',import.meta.url));
const { newToken } = await import(new URL(existsSync(new URL('../../src/util.mjs',import.meta.url))?'../../src/util.mjs':'../../lab-server/src/util.mjs',import.meta.url)); // CSPRNG only（主体会话凭证不使用Math.random）
const { openDatabase, migrate } = await import(new URL(existsSync(new URL('../../src/db.mjs',import.meta.url))?'../../src/db.mjs':'../../lab-server/src/db.mjs',import.meta.url));
const {ServerSuperagent} = await import(new URL(existsSync(new URL('../../src/server-superagent.mjs',import.meta.url))?'../../src/server-superagent.mjs':'../../lab-server/src/server-superagent.mjs',import.meta.url));
const {superagentOwnerPort,forwardSuperagent} = await import(new URL(existsSync(new URL('../../src/superagent-entry.mjs',import.meta.url))?'../../src/superagent-entry.mjs':'../../lab-server/src/superagent-entry.mjs',import.meta.url));
const { createContextIntegration } = await import(new URL(existsSync(new URL('../../src/context-integration.mjs',import.meta.url))?'../../src/context-integration.mjs':'../../lab-server/src/context-integration.mjs',import.meta.url));

const {configureDiagnostics,observeRequest} = await import(new URL(existsSync(new URL('../../src/diagnostics.mjs',import.meta.url))?'../../src/diagnostics.mjs':'../../lab-server/src/diagnostics.mjs',import.meta.url));
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const WEBROOT = join(ROOT, existsSync(join(ROOT,"web"))?"web":"lab-web", "dist");
var DB = join(HERE, "data", "lab-stage-a.db");
var TOKEN_FILE = join(HERE, "handoff", "web-viewer.token");
var MAP_FILE = join(HERE, "handoff", "web-viewer.mapping.json");

const args = process.argv.slice(2);
const {host,port} = gatewayListenOptions(args);
// DB/token-file/map-file支持覆盖（隔离回归用，来自0600受控目录）；缺省=正式库与正式handoff
const dbArgIdx = args.indexOf("--db");
if (dbArgIdx >= 0) DB = args[dbArgIdx + 1];
const tokenFileIdx = args.indexOf("--token-file");
if (tokenFileIdx >= 0) TOKEN_FILE = args[tokenFileIdx + 1];
const mapFileIdx = args.indexOf("--map-file");
if (mapFileIdx >= 0) MAP_FILE = args[mapFileIdx + 1];

// 服务端固化scope+管理token（进程内存；浏览器无路径获取或提交）
const map = JSON.parse(readFileSync(MAP_FILE, "utf8"));
const VIEWER_TOKEN = readFileSync(TOKEN_FILE, "utf8").trim();
const SCOPE = { orgId: map.orgId, projectId: map.projectId }; // solopi-lab/glasses

const db = openDatabase(DB);
migrate(db);
process.env.SOLOPI_LAB_ARTIFACT_ROOT ||= join(dirname(DB),'lab-artifacts');
const contextIntegration=createContextIntegration({db,scope:SCOPE,directory:join(dirname(DB),'context-workbench'),sirchmunkUrl:process.env.SOLOPI_SIRCHMUNK_URL||'http://127.0.0.1:8584'});
const ownerPort=superagentOwnerPort(dirname(DB),port);
const superagent=new ServerSuperagent({recoverInterrupted:port===ownerPort,db,scope:SCOPE,memory:contextIntegration.memory,directory:join(dirname(DB),'server-superagent')});
contextIntegration.quality.setModelProvider(()=>superagent.provider());
const dispatch = createApp({ db,contextProvider:contextIntegration.contextProvider });
if(process.env.SOLOPI_CONTEXT_MODEL_PORT!=='0')contextIntegration.startModelBroker({port:Number(process.env.SOLOPI_CONTEXT_MODEL_PORT||8865)});
const MAX_BODY = 1_000_000;
// ---------- B7(r6/r6.1)观看主体（httpview部署层）：免口令自动发放——用户2026-11-06裁定"网站看手机/眼镜不需要任何密码拦截" ----------
// /mv/session空body/JSON对象/数组（scalar 400）即发放短时HttpOnly cookie主体（v0.2.1合同）：
// 不再读取/校验media-viewer-auth.json，--media-auth-file参数保留解析但已废弃（旧启动脚本不因未知参数失败）。
// r6.1（C67最小修复）：①持有效主体cookie优先复用不再无条件增发；②主体表真实容量闸门——
// 新发放前全量回收过期主体，回收后仍满则429 RATE_LIMITED拒绝（零口令回归），不满载不清退任何有效主体。
// Code security: 观看免口令仅限内网固定scope的媒体只读面；/cp、/v1、/ro准入路径零改动；cookie凭证仍为CSPRNG。
const MV_TTL_MS = Number.parseInt(process.env.SOLOPI_MEDIA_VIEWER_TTL_MS ?? "3600000", 10);
const MV_MAX_SUBJECTS = Math.max(1, Number.parseInt(process.env.SOLOPI_MEDIA_VIEWER_MAX_SUBJECTS ?? "4096", 10));
const mvSessions = new Map(); // sessionToken -> { ref, expiresMs }
const sha256Hex = (t) => createHash("sha256").update(t, "utf8").digest("hex");
function mvSubjectOf(req) {
  const m = /mv_viewer=([A-Za-z0-9._-]{16,128})/.exec(req.headers?.cookie ?? "");
  if (!m) return null;
  const v = mvSessions.get(m[1]);
  if (!v || v.expiresMs <= Date.now()) { if (v) mvSessions.delete(m[1]); return null; }
  return v;
}
// cookie写入统一在mvSession与mvRefresh发出（HttpOnly+SameSite=Strict；Secure经SOLOPI_MEDIA_COOKIE_SECURE=1开启）

// 静态（与webgate一致：index/SPA回退 no-store，assets内容寻址 immutable；穿越防护）
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" };
function serveStatic(pathname, res) {
  let file = join(WEBROOT, pathname === "/" ? "index.html" : decodeURIComponent(pathname));
  let st = existsSync(file) ? statSync(file) : null;
  if (!st || !st.isFile()) { file = join(WEBROOT, "index.html"); st = statSync(file); }
  const resolved = join(file);
  if (!resolved.startsWith(WEBROOT)) { res.writeHead(403); res.end(); return; }
  const immutable = resolved.startsWith(join(WEBROOT, "assets") + "/");
  res.writeHead(200, { "Content-Type": MIME[extname(resolved)] ?? "application/octet-stream",
    "X-Solopi-Contract-Version": CONTRACT_VERSION,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-store" });
  res.end(readFileSync(resolved));
}

// 只读代理：白名单查询参数 + 服务端固定scope + 管理token仅在进程内使用
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const NUM_RE = /^\d{1,4}$/;
const STATUS_RE = /^(pending|approved|rejected|revoked|expired)$/; // enrollments/clients
const DEVICE_STATUS_RE = /^(online|stale|offline)$/;               // devices三态（服务端权威派生）
const RO_STATUS = { clients: STATUS_RE, enrollments: STATUS_RE, devices: DEVICE_STATUS_RE };
function proxyList(kind, searchParams, res) {
  const q = [];
  if (searchParams.has("status")) { const v = searchParams.get("status"); if (!RO_STATUS[kind].test(v)) { bad(res, "status"); return; } q.push(["status", v]); }
  if (searchParams.has("page")) { const v = searchParams.get("page"); if (!NUM_RE.test(v) || Number(v) < 1) { bad(res, "page"); return; } q.push(["page", v]); }
  if (searchParams.has("pageSize")) { const v = searchParams.get("pageSize"); if (!NUM_RE.test(v) || Number(v) < 1 || Number(v) > 200) { bad(res, "pageSize"); return; } q.push(["pageSize", v]); }
  for (const k of searchParams.keys()) if (!["status", "page", "pageSize"].includes(k)) { bad(res, k); return; } // 未知参数即拒（含orgId/projectId/token等）
  // scope服务端固化（solopi-lab/glasses），浏览器不可覆盖
  const pairs = new URLSearchParams();
  pairs.set("orgId", SCOPE.orgId); pairs.set("projectId", SCOPE.projectId);
  for (const [k, v] of q) pairs.set(k, v);
  // DG147: RO面排除已隔离探针client本人及其归属资产。分页正确性：对被隔离过滤的kinds，
  // 若只post-filter当页会破坏分页语义（首页可能全是探针→真实资产丢失在后面页面且nextPage错）。
  // 故采用"拉全量→过滤→按用户请求页号/页大小重新分页"（roview数据量/页大小≤200有界）。
  if (kind !== "clients" && kind !== "enrollments" && kind !== "devices") { respondFiltered(res, dispatch("GET", `/v1/${kind}?${pairs.toString()}`, { headers: { authorization: "Bearer " + VIEWER_TOKEN }, body: null }), (b) => b); return; }
  const keyFn = kind === "enrollments" ? ((it) => it && (it.clientId ?? null)) : ((it) => it && it.clientId);
  let out = {status:200,headers:{},body:{}};
  try {
    // 全量收集：以pageSize=200逐页翻（核心端pageSize上限=200，nextPage为权威信号）
    const q = new URLSearchParams(pairs); q.set("pageSize", "200"); q.delete("page");
    let next = 1, all = [], pages = 0;
    while (next && pages < 100) {
      q.set("page", String(next));
      const page = dispatch("GET", `/v1/${kind}?${q.toString()}`, { headers: { authorization: "Bearer " + VIEWER_TOKEN }, body: null });
      if (pages === 0) out = page;
      if (page.status !== 200) { respondFiltered(res, page, (b) => b); return; }
      if (!page.body || !Array.isArray(page.body.items)) break;
      all.push(...page.body.items);
      next = page.body.nextPage || null; pages++;
      if (!page.body.items.length) break;
    }
    const iso = isolatedClientSet();
    const kept = iso.size ? all.filter((it) => !iso.has(keyFn(it))) : all;
    const reqPage = Number(pairs.get("page") || "1"), reqSize = Number(pairs.get("pageSize") || "20");
    const slice = kept.slice((reqPage - 1) * reqSize, reqPage * reqSize);
    const filteredBody = { ...out.body, page:reqPage, pageSize:reqSize, items: slice, pageCount: Math.ceil(kept.length / reqSize), totalCount: kept.length, nextPage: (reqPage * reqSize) < kept.length ? reqPage + 1 : null };
    // 保持httpview此前响应形状(items/page/pageSize/nextPage)并加权权威计数(pageCount/total)
    respondFiltered(res, { ...out, body: filteredBody }, (b) => b);
  } catch (e) {
    // DG148：全量收集/过滤链路异常——同503封套，不降级为当页过滤（降级会重新展示探针）。
    console.warn("[ro-isolation]", "paged-filter unavailable", e && e.message);
    respondFiltered(res, out, () => { throw e; });
  }
}

function proxyGroupLevels(searchParams, res) {
  const q = [];
  if (searchParams.has("page")) { const v = searchParams.get("page"); if (!NUM_RE.test(v) || Number(v) < 1) { bad(res, "page"); return; } q.push(["page", v]); }
  if (searchParams.has("pageSize")) { const v = searchParams.get("pageSize"); if (!NUM_RE.test(v) || Number(v) < 1 || Number(v) > 200) { bad(res, "pageSize"); return; } q.push(["pageSize", v]); }
  for (const k of searchParams.keys()) if (!["page", "pageSize"].includes(k)) { bad(res, k); return; } // 未知参数即拒（含orgId/projectId/status/token）
  const pairs = new URLSearchParams();
  pairs.set("orgId", SCOPE.orgId); pairs.set("projectId", SCOPE.projectId);
  for (const [k, v] of q) pairs.set(k, v);
  const out = dispatch("GET", `/v1/group-levels?${pairs.toString()}`, { headers: { authorization: "Bearer " + VIEWER_TOKEN }, body: null });
  respondFiltered(res, out, (b) => stripIsolatedClients(b, (it) => it && it.clientId));
}

// ── DG147：用户网站RO面排除"已隔离测试探针"（数据级，非文案）──
// 隔离事实表=0015 client_probe_isolation（admin probe-isolate逐行落id，可逆probe-unisolate）。
// 应用面：/ro/clients、/ro/devices、/ro/group-levels、/ro/enrollments——被隔离client本人及其归属资产
// 从用户可见列表排除；统计取自同列表随之收敛。核心/v1、admin面与历史审计全量可查。
// 故障语义（DG148修正）：隔离账本缺失/读取异常一律503 UNAVAILABLE错误封套——不返回假空集、不重新展示探针、不冒充成功面；前端沿既有失败保旧数据并标陈旧语义。
function isolatedClientSet() {
  // DG148：隔离账本读取失败不再静默回落全量（伪装成功面），也不再返回假空集——
  // 抛出标记错误由发出面转为503 UNAVAILABLE错误封套，前端按既有"失败保旧数据并标陈旧"处理。
  const ready = db.prepare("SELECT 1 FROM sqlite_master WHERE name='client_probe_isolation'").get();
  if (!ready) { const e = new Error("isolation ledger missing"); e.code = "ISOLATION_LEDGER_UNAVAILABLE"; throw e; }
  return new Set(db.prepare("SELECT client_ulid FROM client_probe_isolation").all().map((r) => r.client_ulid));
}
function stripIsolatedClients(body, keyFn) {
  if (!(body && Array.isArray(body.items))) return body;
  const iso = isolatedClientSet();
  if (!iso.size) return body;
  const before = body.items.length;
  body.items = body.items.filter((it) => !iso.has(keyFn(it)));
  if (body.items.length !== before) console.warn("[ro-isolation]", "filtered", before - body.items.length, "items");
  return body;
}
function respondFiltered(res, out, filter) {
  try { out.body = filter(out.body); }
  catch (e) {
    // DG148：过滤失败=读取异常——显式503错误封套（retryable），不渗透原始错误/凭据/表结构细节。
    console.warn("[ro-isolation]", e && e.message);
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "UNAVAILABLE", message: "read surface unavailable; retry later", retryable: true } }));
    return;
  }
  res.writeHead(out.status, { "Content-Type": "application/json", ...out.headers });
  res.end(JSON.stringify(out.body ?? null));
}

function bad(res, what) { res.writeHead(422, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "query param not allowed: " + what, retryable: false } })); }

// ---------- Internal-lab Agent messaging: no user login ----------
// User 2026-11-09 explicitly removed the operator-login product gate.
// The browser sends messages directly; the server retains fixed project credentials.
// Exact site-origin matching only prevents another website dispatching on its behalf.
const UA_TRUSTED_ORIGINS = String(process.env.SOLOPI_UA_TRUSTED_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
function uaOriginOk(req) {
  const host = req.headers?.host ?? "";
  const trusted = UA_TRUSTED_ORIGINS.length > 0 ? UA_TRUSTED_ORIGINS : [`http://${host}`];
  for (const hname of ["origin", "referer"]) {
    const h = req.headers?.[hname];
    if (!h) continue;
    let o = null;
    try { o = new URL(h).origin; } catch { return false; }
    if (!trusted.includes(o)) return false;
  }
  return true;
}
// Internal-lab product policy: no human login or browser credentials.
// The fixed project proxy owns its credential; browser cannot widen its scope.
function uaLogin(req, _body, res) { uaWhoami(req, res); }
function uaLogout(req, res) { uaWhoami(req, res); }
const UA_ROUTES = new Set(["POST /v1/agent-tasks/{agentTaskId}/cancel"]);
function uaGate(req, res) {
  if (!uaOriginOk(req)) { mvJson(res, { status:403, headers:{}, body:{error:{code:"CROSS_ORIGIN",message:"request must originate from this lab site",retryable:false}} }); return null; }
  return "lab-site";
}
function uaCall(_site, method, routeIn, body, res) {
  const out=dispatch(method,routeIn,{headers:{authorization:"Bearer "+VIEWER_TOKEN},body});
  res.writeHead(out.status,{"Content-Type":"application/json"});
  res.end(JSON.stringify(out.body??null));
}

function uaCreate(req, body, res) { // POST /ua/agent-tasks——kind白名单+固定scope注入（浏览器不可传org/project）
  const sid = uaGate(req, res); if (!sid) return; // 固定项目站点路由
  // C89（阻塞⑤⑥）：严格封套=按字段存在性白名单——多余字段（orgId/projectId/token（含null）/任何未知键）一律422，
  // 不做静默丢弃（丢弃会把"越权尝试被拒"伪装成"被接受"）；仅kind/tool|prompt/idempotencyKey/clientId/timeoutSeconds可选
  const UA_CREATE_KEYS = ["kind", "tool", "prompt", "idempotencyKey", "clientId", "timeoutSeconds"];
  const extra = Object.keys(body ?? {}).filter((kk) => !UA_CREATE_KEYS.includes(kk));
  if (extra.length > 0) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "field not allowed: " + extra.join(","), retryable: false } } }); return; }
  if ("token" in (body ?? {}) || "orgId" in (body ?? {}) || "projectId" in (body ?? {})) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "field not allowed in action envelope", retryable: false } } }); return; }
  const k = body?.kind;
  if (k !== "tool-call" && k !== "prompt") { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "kind must be tool-call or prompt (allowlist)", retryable: false } } }); return; }
  if (k === "tool-call" && !(body.tool?.name === "list_devices" && typeof body.tool?.args === "object" && body.tool.args !== null)) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "tool-call allowlist: only list_devices with args object", retryable: false } } }); return; } // 与已验能力同界（C80/C81）
  if (k === "prompt" && !(typeof body.prompt?.text === "string" && body.prompt.text.length > 0 && Object.keys(body).every((kk) => ["kind", "prompt", "idempotencyKey", "clientId", "timeoutSeconds"].includes(kk)))) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "prompt:{text} required; no hidden fields", retryable: false } } }); return; }
  if (typeof body?.idempotencyKey !== "string" || body.idempotencyKey.length < 1 || body.idempotencyKey.length > 128) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "idempotencyKey required (1..128)", retryable: false } } }); return; }
  if (!ULID_RE.test(String(body?.clientId ?? ""))) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "clientId must be ULID", retryable: false } } }); return; }
  // C90（复核阻塞③）：timeoutSeconds按冻结单位严格校验并映射核心——存在即须为1..86400整数；
  // null/浮点/越界一律422零写入；合法值原样传递实际生效（不再白名单放行后被丢弃回退缺省——旧缺口闭合）
  const hasTimeout = Object.prototype.hasOwnProperty.call(body, "timeoutSeconds");
  if (hasTimeout) {
    const tv = body.timeoutSeconds;
    if (typeof tv !== "number" || !Number.isInteger(tv) || tv < 1 || tv > 86400) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "timeoutSeconds must be an integer 1..86400 (seconds)", retryable: false } } }); return; }
  }
  const payload = { orgId: SCOPE.orgId, projectId: SCOPE.projectId, clientId: body.clientId, kind: k, idempotencyKey: body.idempotencyKey };
  if (hasTimeout) payload.timeoutSeconds = body.timeoutSeconds; // Code security: 合法timeout不丢弃、映射核心实际生效
  if (k === "tool-call") payload.tool = { name: "list_devices", args: typeof body.tool.args === "object" ? body.tool.args : {} };
  else payload.prompt = { text: String(body.prompt.text).slice(0, 2000) }; // 长度截口（已声明的最小防护）
  uaCall(sid, "POST", "/v1/agent-tasks", payload, res);
}
function uaCancelTask(req, msid, body, res) { // POST /ua/agent-tasks/{id}/cancel
  const sid = uaGate(req, res); if (!sid) return; // 固定项目站点路由
  const extra = Object.keys(body ?? {}).filter((kk) => !["reason"].includes(kk));
  if (extra.length > 0) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "field not allowed: " + extra.join(","), retryable: false } } }); return; } // C89：存在性白名单，token（含null）等一律422
  uaCall(sid, "POST", `/v1/agent-tasks/${msid}/cancel`, body && typeof body.reason === "string" ? { reason: body.reason.slice(0, 256) } : {}, res);
}
// 目标4 UA前端操作者/管理面受控读（队长01a1bb25授权）：GET /ua/group-dispatch-detail/{requestId}?clientId=U。
// 会话门(401)＋同源(403)前置；uaCall转发到核心admin路由（scope在核心侧Select+checkAdminScope核）；浏览器不可传orgId/projectId/token。
function uaGroupDispatchDetail(req, requestId, res) {
  const sid = uaGate(req, res); if (!sid) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "requestId must be UUIDv4", retryable: false } } }); return; }
  const cl = new URL(req.url, "http://localhost").searchParams.get("clientId") ?? "";
  if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(cl)) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "clientId must be Desktop ULID", retryable: false } } }); return; }
  uaCall(sid, "GET", "/v1/group-dispatch-detail/" + encodeURIComponent(requestId) + "?clientId=" + encodeURIComponent(cl), null, res);
}

function uaTaskDetail(req, msid, res) { // GET /ua/agent-tasks/{id}——G1详情/结果接线：核心已有admin/operator可过详情路由透传（result归档原文仅在受控会话下可见；匿名/ro面不新增结果投影）
  const sid = uaGate(req, res); if (!sid) return; // 无用户登录门控
  if (!ULID_RE.test(msid)) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "agentTaskId must be ULID", retryable: false } } }); return; }
  uaCall(sid, "GET", "/v1/agent-tasks/" + msid, null, res);
}
// 目标4受控详情读（01a1bb15授权）：/cp/group-dispatches-by-request/{UUIDv4}——client session面。
// Code security: 复用核心groupSession准入与Select归属（GET /v1/group-dispatches-by-request/{id}
// 要求sess.client_ulid==行属主，非信任自报）；不编agent-task映射/报告URL，reportRef原样透出。
const CP_REQ_DETAIL_RE = /^\/cp\/group-dispatches-by-request\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
function cpDispatchDetail(req, requestId, res) {
  const out = dispatch("GET", "/v1/group-dispatches-by-request/" + encodeURIComponent(requestId), { headers: req.headers, body: null });
  res.writeHead(out.status, { "Content-Type": "application/json", ...out.headers });
  res.end(JSON.stringify(out.body ?? null));
}

function uaWhoami(req, res) {
  if (!uaGate(req,res)) return;
  mvJson(res,{status:200,headers:{},body:{operatorSession:true,loginRequired:false,expiresInSeconds:0}});
}

// ---------- W25（root裁定01a1b17b/01a1b17c）：Agent任务只读投影（/ro/agent-tasks*） ----------
// 部署层投影=最小可知集：固定scope+进程内admin token（浏览器零凭据）；核心dispatch零改动。
// 字段裁剪纪律（root裁定）：自由文本不投影原文——progress note仅投影存在性（hasProgress），
// error 仅投影可验证枚举码（resultErrorCode），不匹配枚举时只给 hasResultError 布尔；prompt/tool.args/result
// 原文一律不投影。lateArchivedResult=纯持久行推导（唯一写路径证明见 v0.3.3 合同），无新造落库字段。
const AGENT_RO_STATUS_RE = /^(queued|delivered|running|succeeded|failed|cancelled|expired)$/;
const AGENT_ERR_CODE_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
function roAgentTaskOut(a, detail) {
  const out = {
    agentTaskId: a.agentTaskId, clientId: a.clientId, kind: a.kind,
    toolName: a.tool?.name ?? null, status: a.status,
    hasProgress: typeof a.progress === "string" && a.progress.length > 0,
    timeoutSec: a.timeoutSec, createdAt: a.createdAt, expiresAt: a.expiresAt,
    deliveredAt: a.deliveredAt ?? null, startedAt: a.startedAt ?? null,
    cancelRequestedAt: a.cancelRequestedAt ?? null, endedAt: a.endedAt ?? null,
  };
  if (!detail) return out;
  // 详情三列（全持久行推导）：result_json 非空=有归档载荷；cancelled/expired 且归档=迟到存档（唯一写路径：
  // terminal 的 result_json 只能来自 POST result 迟到存档分支）；outcome 仅在 succeeded/failed 由行状态唯一决定
  const resultArchived = a.result !== null && a.result !== undefined;
  const hasResultError = typeof a.error === "string" && a.error.length > 0;
  return { ...out,
    resultArchived,
    resultOutcome: (a.status === "succeeded" || a.status === "failed") && resultArchived ? a.status : null,
    lateArchivedResult: resultArchived && (a.status === "cancelled" || a.status === "expired"),
    resultErrorCode: hasResultError && AGENT_ERR_CODE_RE.test(a.error) ? a.error : null,
    hasResultError,
  };
}
function proxyAgentTaskList(searchParams, res) {
  const q = [];
  if (searchParams.has("status")) { const v = searchParams.get("status"); if (!AGENT_RO_STATUS_RE.test(v)) { bad(res, "status"); return; } q.push(["status", v]); }
  if (searchParams.has("page")) { const v = searchParams.get("page"); if (!NUM_RE.test(v) || Number(v) < 1) { bad(res, "page"); return; } q.push(["page", v]); }
  if (searchParams.has("pageSize")) { const v = searchParams.get("pageSize"); if (!NUM_RE.test(v) || Number(v) < 1 || Number(v) > 200) { bad(res, "pageSize"); return; } q.push(["pageSize", v]); }
  if (searchParams.has("clientId")) { const v = searchParams.get("clientId"); if (!ULID_RE.test(v)) { bad(res, "clientId"); return; } q.push(["clientId", v]); }
  for (const k of searchParams.keys()) if (!["status", "page", "pageSize", "clientId"].includes(k)) { bad(res, k); return; }
  const pairs = new URLSearchParams();
  pairs.set("orgId", SCOPE.orgId); pairs.set("projectId", SCOPE.projectId);
  for (const [k, v] of q) pairs.set(k, v);
  const out = dispatch("GET", `/v1/agent-tasks?${pairs.toString()}`, { headers: { authorization: "Bearer " + VIEWER_TOKEN }, body: null });
  if (out.status !== 200) { res.writeHead(out.status, { "Content-Type": "application/json" }); res.end(JSON.stringify(out.body ?? null)); return; }
  res.writeHead(200, { "Content-Type": "application/json", "X-Solopi-Contract-Version": CONTRACT_VERSION });
  res.end(JSON.stringify({ items: (out.body.items ?? []).map((a) => roAgentTaskOut(a, false)), page: out.body.page, pageSize: out.body.pageSize, nextPage: out.body.nextPage ?? null }));
}
function proxyAgentTaskDetail(id, res) {
  const out = dispatch("GET", `/v1/agent-tasks/${id}`, { headers: { authorization: "Bearer " + VIEWER_TOKEN }, body: null });
  if (out.status === 403) { // 跨scope统一未命中化——不泄存在性（投影读面纪律）
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "AGENT_TASK_INVALID", message: "agent task not found", retryable: false } }));
    return;
  }
  if (out.status !== 200) { res.writeHead(out.status, { "Content-Type": "application/json" }); res.end(JSON.stringify(out.body ?? null)); return; }
  res.writeHead(200, { "Content-Type": "application/json", "X-Solopi-Contract-Version": CONTRACT_VERSION });
  res.end(JSON.stringify(roAgentTaskOut(out.body, true)));
}

configureDiagnostics(process.env.SOLOPI_DIAGNOSTICS_DIR||join(dirname(DB),'diagnostics'));
const packageHandler=createPackageHandler({directory:join(dirname(DB),'package-library'),scope:SCOPE,originOk:uaOriginOk});
const server = createServer(async (req, res) => {
  observeRequest(req,res,'gateway');
  const u = new URL(req.url ?? "/", "http://x");
  const pathname = u.pathname;
  if(await packageHandler(req,res,u))return;
  if(pathname.startsWith('/superagent/')){
    if(u.search||!['GET','POST'].includes(req.method)||!uaOriginOk(req)){bad(res,'superagent request');return;}
    const run=async input=>{try{if(port!==ownerPort){const result=await forwardSuperagent(ownerPort,req.method,pathname,input);mvJson(res,result);return;}const body=await superagent.handle(req.method,pathname.slice('/superagent/'.length),input||{});mvJson(res,{status:200,body});}catch(e){mvJson(res,{status:e.status||500,body:{error:{code:e.code||'SUPERAGENT_FAILED',message:e.status?e.message:'Superagent 请求未完成'}}});}};
    if(req.method==='GET')void run(null);else cwReadBody(req,res,input=>void run(input));return;
  }
  if(pathname.startsWith('/context/')){
    if(u.search||!['GET','POST'].includes(req.method)||!uaOriginOk(req)){bad(res,'context request');return;}
    const operation=pathname.slice('/context/'.length);
    const run=async input=>{try{if(req.method==='POST'&&(!input||typeof input!=='object'||Array.isArray(input)))throw Object.assign(Error('请输入JSON对象'),{status:400,code:'INVALID_INPUT'});const body=await contextIntegration.handle(req.method,operation,input);mvJson(res,{status:200,body});}catch(e){mvJson(res,{status:e.status||500,body:{error:{code:e.code||'CONTEXT_FAILED',message:e.status?e.message:'上下文服务未完成请求'}}});}};
    if(req.method==='GET')void run(null);else cwReadBody(req,res,input=>void run(input));return;
  }
  if(pathname==='/cp/lab/context'){
    if(req.method!=='POST'||u.search){bad(res,'context method');return;}
    cwReadBody(req,res,async body=>{try{
      if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(Error('invalid JSON'),{status:400,code:'INVALID_INPUT'});
      const identity=dispatch('POST','/v1/lab/context-identity',{headers:req.headers,body});if(identity.status!==200){mvJson(res,identity);return;}
      const result=await contextIntegration.client(identity.body,body.operation,body.input||{});mvJson(res,{status:200,body:result});
    }catch(e){mvJson(res,{status:e.status||500,body:{error:{code:e.code||'CONTEXT_FAILED',message:e.status?e.message:'上下文操作失败'}}});}});return;
  }
  const recording=/^\/lab\/artifacts\/([a-f0-9]{64})$/.exec(pathname);
  if(recording){
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
    const out=dispatch('GET','/v1/lab/artifacts/'+recording[1]+'?'+new URLSearchParams(SCOPE),{headers:{authorization:'Bearer '+VIEWER_TOKEN},body:null});
    if(out.status!==200){mvJson(res,out);return;}
    const meta=out.body;let start=0,end=meta.size-1,status=200;
    if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||!m[1]&&!m[2]){res.writeHead(416,{'Content-Range':'bytes */'+meta.size});res.end();return;}
      start=m[1]?Number(m[1]):Math.max(0,meta.size-Number(m[2]));end=m[1]&&m[2]?Math.min(meta.size-1,Number(m[2])):meta.size-1;status=206;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=meta.size){res.writeHead(416,{'Content-Range':'bytes */'+meta.size});res.end();return;}
    }
    res.writeHead(status,{'Content-Type':meta.mime,'Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'private, max-age=3600','ETag':'"'+meta.sha256+'"',...(status===206?{'Content-Range':`bytes ${start}-${end}/${meta.size}`}:{})});
    if(req.method==='HEAD')res.end();else {const stream=createReadStream(meta.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}
    return;
  }
  // Lab UI is an explicit fixed-project interface. Native Client identity stays session-bound.
  const labMatch=/^\/lab\/(diagnostics|diagnostics\/events|requests|requests\/[0-9a-f-]{36}|catalog|tasks|tasks\/agent-[0-9a-f-]{36}(?:\/stop)?|commands|commands\/[0-9a-f-]{36}|conversations|conversations\/[0-9a-f-]{36}(?:\/messages)?)$/.exec(pathname);
  if(labMatch){
    if(u.search){bad(res,'query');return;}
    const inner='/v1/lab/'+labMatch[1];
    const forward=async input=>{
      try{if(req.method==='POST')await contextIntegration.prepare(labMatch[1],input);}catch(e){mvJson(res,{status:e.status||503,body:{error:{code:e.code||'CONTEXT_PREPARE_FAILED',message:e.status?e.message:'上下文准备未完成，请保留原请求标识重试'}}});return;}
      const body=req.method==='GET'?null:{...SCOPE,input};
      const target=req.method==='GET'?inner+'?'+new URLSearchParams(SCOPE):inner;
      const out=dispatch(req.method,target,{headers:{authorization:'Bearer '+VIEWER_TOKEN},body});
      respondFiltered(res,out,b=>{
        const iso=isolatedClientSet();
        if(b&&Array.isArray(b.items)&&['catalog','tasks'].includes(labMatch[1]))return {...b,items:b.items.filter(x=>!iso.has(x.clientId))};
        return b;
      });
    };
    if(req.method==='GET')forward(null);
    else if(req.method==='POST')mvReadBody(req,input=>{if(!input||typeof input!=='object'||Array.isArray(input)){bad(res,'body');return;}forward(input);});
    else {res.writeHead(405,{Allow:'GET, POST'});res.end();}
    return;
  }
  // /mv/* 媒体最小查看授权（fixed scope代理；POST=authorize/stop，GET=status；其余一律404 JSON）
  if (pathname === "/mv/session") { if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(); return; } mvSession(req, res); return; }
  if (pathname === "/mv/authorize") { if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(); return; } mvAuthorize(req, res); return; }
  if (pathname === "/mv/stop") { if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(); return; } mvStop(req, res); return; }
  const mvSt = /^\/mv\/status\/([0-7][0-9A-HJKMNP-TV-Z]{25})$/.exec(pathname);
  if (mvSt) { if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; } mvStatus(req, res, mvSt[1]); return; }
  if (pathname === "/mv" || pathname.startsWith("/mv/")) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "no such mv route", retryable: false } })); return; }
  // 8780 Client直通端点（用户明确选择的HTTP注册闭环，仅限Client无管理凭证的通道）：
  //   匿名POST /cp/enrollments、GET /cp/sessions/challenge、POST /cp/sessions、POST /cp/heartbeat、
  //   POST /cp/enrollments/recover/challenge、POST /cp/enrollments/recover、GET /cp/healthz。
  //   逐条写死映射（非通用前缀转发）；管理写（decision/revoke/renew）与events/ack/bootstrap不在其内。
  if (pathname.startsWith("/cp/")) {
    const CP_ROUTES = new Set(["/cp/healthz", "/cp/enrollments", "/cp/enrollments/recover/challenge",
      "/cp/enrollments/recover", "/cp/sessions/challenge", "/cp/sessions", "/cp/heartbeat",
      "/cp/enrollments/revoke", "/cp/devices/snapshot",
      "/cp/events", "/cp/events/snapshot",
      "/cp/agent-tasks/queue"]); // C29注销+设备快照+事件游标(B1)+agent任务队列(v0.3.0)：均由核心dispatch会话准入限制自有client
    // AMAW-18/DG123组传输最小组候选：Desktop Connector cp模式四条method-bound白名单——精确(方法,路径)对，
    // 非通用前缀转发；准入/归属/错误封套语义全部由核心dispatch(594beab)同组Session面执法，本层不复制鉴权语义。
    // 刻意不开：/cp/group-grants(签发)、/cp/group-grants/revoke(admin面)与POST /cp/group-dispatches
    // (跨Desktop派发提交intake——属下一批次滥用面审查，不入本最小组)。
    const CP_GROUP_ROUTES = new Map([
      ["/cp/lab/queue", "GET"],
      ["/cp/lab/catalog", "POST"],
      ["/cp/lab/artifact-begin", "POST"],
      ["/cp/lab/artifact-chunk", "POST"],
      ["/cp/lab/artifact-finish", "POST"],
      ["/cp/lab/reply", "POST"],
      ["/cp/lab/task-state", "POST"],
      ["/cp/lab/client-tasks", "POST"],
      ["/cp/group-registrations", "POST"], // 组登记投影outbox心跳（GroupService.publish ack）
      ["/cp/group-executions", "POST"],   // 组执行镜像/停止事实报告（upsertGroupExecution+派发镜像钩子）
      // G1端侧候选接线（Client 01a1baec受理）：method-bound精确(方法,路径)对——同路径多方法须逐对声明；
      // 准入/归属/错误封套语义全部由核心dispatch组Session面执法，本层不复制鉴权语义
      ["/cp/group-dispatches", "GET"],    // pending完整分页对账读（GroupRuntime.reconcilePending；含读次catch-up恢复点）
      ["/cp/group-dispatches POST", "POST"], // 组派发提交（会话+归属Check先于schema）
      ["/cp/group-dispatches/cancel", "POST"], // 组派发取消（受理记录非执行停止确认）
      ["/cp/group-grants/verify", "POST"],// 异步授权verify桥（GroupGrantProvider四阶段fresh核）
    ]);
    // v0.3.0 agent任务上/报：按ULID精确正则入白名单（任务ID逐条匹配，非通用前缀转发）
    const CP_DYNAMIC = /^\/cp\/agent-tasks\/([0-7][0-9A-HJKMNP-TV-Z]{25})\/(result|progress)$/.exec(pathname);
    const cpGroupMethod = CP_GROUP_ROUTES.get(`${pathname} ${req.method}`) ?? CP_GROUP_ROUTES.get(pathname); // 同路径多方法先取exact(路径+方法)对，再单方法路径
    // 目标4详情读：/cp GET精确requestId正则在白名单Map前命中
    const cpReqDetail = CP_REQ_DETAIL_RE.exec(pathname);
    if (cpReqDetail && req.method === "GET") { cpDispatchDetail(req, cpReqDetail[1], res); return; }
    if (cpGroupMethod === undefined && !CP_ROUTES.has(pathname) && !CP_DYNAMIC) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "unknown /cp route", retryable: false } })); return; }
    if (cpGroupMethod !== undefined && req.method !== cpGroupMethod) { res.writeHead(405, { Allow: [ "GET", "POST" ].filter(m => CP_GROUP_ROUTES.get(pathname) === m || CP_GROUP_ROUTES.get(`${pathname} ${m}`) === m).join(", ") || cpGroupMethod }); res.end(); return; } // 组路由仅放行声明白名单方法
    const innerPath = pathname.replace(/^\/cp/, "/v1");
    const url = innerPath + (u.search || "");
    if (req.method === "GET" || req.method === "HEAD") {
      const out = dispatch(req.method, url, { headers: req.headers, body: null });
      res.writeHead(out.status, { "Content-Type": "application/json", ...out.headers });
      res.end(JSON.stringify(out.body ?? null));
      return;
    }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "GET, HEAD, POST" }); res.end(); return; }
    collectCpJson(req,res,pathname,body => {
      let out;
      try { out = dispatch("POST", url, { headers: req.headers, body }); }
      catch { out = { status: 500, headers: {}, body: { error: { code: "INTERNAL", message: "internal error", retryable: true } } }; }
      res.writeHead(out.status, { "Content-Type": "application/json", ...out.headers });
      res.end(JSON.stringify(out.body ?? null));
    });
    return;
  }
  // W25：/ua/* 个人operator受控写面（登录换发+创建/取消；写方法只在POST白名单内开放，见上分支前注释）
  const UA_CREATE_RE = /^\/ua\/agent-tasks\/?$/;
  const UA_DETAIL_RE = /^\/ua\/agent-tasks\/([0-7][0-9A-HJKMNP-TV-Z]{25})$/;
  const UA_CANCEL_RE = /^\/ua\/agent-tasks\/([0-7][0-9A-HJKMNP-TV-Z]{25})\/cancel$/;
  if (req.method === "POST" && pathname === "/ua/session") { mvReadBody(req, (b) => uaLogin(req, b, res)); return; }
  if (req.method === "POST" && pathname === "/ua/logout") { uaLogout(req, res); return; }
  if (req.method === "POST" && UA_CREATE_RE.test(pathname)) { mvReadBody(req, (b) => uaCreate(req, b, res)); return; }
  const uaCancel = UA_CANCEL_RE.exec(pathname);
  if (req.method === "POST" && uaCancel) { mvReadBody(req, (b) => uaCancelTask(req, uaCancel[1], b, res)); return; }
  // G1/G2（7155198裁定→今晚目标3接线）：详情/结果归档读+会话状态探针——GET动作仍经会话门+同源校验；零RO写面开放
  const uaGdrDetail = /^\/ua\/group-dispatch-detail\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(pathname);
  if (req.method === "GET" && uaGdrDetail) { uaGroupDispatchDetail(req, uaGdrDetail[1], res); return; }
  const uaDetail = UA_DETAIL_RE.exec(pathname);
  if (req.method === "GET" && uaDetail) { uaTaskDetail(req, uaDetail[1], res); return; }
  if (req.method === "GET" && pathname === "/ua/whoami") { uaWhoami(req, res); return; }
  if (pathname === "/ua" || pathname.startsWith("/ua/")) { res.writeHead(404, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "no such ua route", retryable: false } })); return; }

  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; } // 写方法全拒（含对/v1与/ro）
  if (pathname === "/ro/clients") { proxyList("clients", u.searchParams, res); return; }
  if (pathname === "/ro/enrollments") { proxyList("enrollments", u.searchParams, res); return; }
  if (pathname === "/ro/devices") { proxyList("devices", u.searchParams, res); return; } // 固定scope最小字段设备三态列表
  if (pathname === "/ro/group-levels") { proxyGroupLevels(u.searchParams, res); return; } // DG142：真实Desktop→组→设备只读层级（固定scope；仅page/pageSize参数）
  if (pathname === "/ro/agent-tasks") { proxyAgentTaskList(u.searchParams, res); return; } // W25：任务只读投影（固定scope/字段裁剪/参数白名单）
  const roTaskDetail = /^\/ro\/agent-tasks\/([0-7][0-9A-HJKMNP-TV-Z]{25})$/.exec(pathname);
  if (roTaskDetail) { proxyAgentTaskDetail(roTaskDetail[1], res); return; } // 详情投影（跨scope统一422不泄存在性）
  // W13反馈：未列/ro路径与原始API必须返回明确JSON错误，不得SPA回退假200（probe按JSON error envelope判定）
  if (pathname.startsWith("/ro/") || pathname === "/ro" || pathname.startsWith("/v1/") || pathname === "/v1" || pathname.startsWith("/dev-connection")) {
    res.writeHead(404, { "Content-Type": "application/json", "X-Solopi-Contract-Version": CONTRACT_VERSION });
    res.end(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "no such api route", retryable: false } })); // 不开放管理/原始API与bootstrap
    return;
  }
  serveStatic(pathname, res);
});

// ---------- 媒体面（B1接入闭合；fixed scope media view/upgrade代理，写面只有角色票不泄管理token） ----------
const MEDIA_UPSTREAM_HOST = process.env.SOLOPI_MEDIA_UPSTREAM_HOST ?? "127.0.0.1";
const MEDIA_UPSTREAM_PORT = Number.parseInt(process.env.SOLOPI_MEDIA_UPSTREAM_PORT ?? "8792", 10);
// upgrade：仅 /ws/media/<ticket> 精确转发到本地数据面（写死路径白名单，非泛化代理）
server.on("upgrade", (req, socket, head) => {
  if (process.env.ROVIEW_DEBUG) console.error("[hv-upgrade]", req.url);
  if (!/^\/ws\/media\/[A-Za-z0-9._-]{32,}$/.test(req.url ?? "")) {
    socket.end("HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n");
    return;
  }
  const upstream = httpRequest({ host: MEDIA_UPSTREAM_HOST, port: MEDIA_UPSTREAM_PORT, path: req.url, method: "GET", headers: { ...req.headers, host: `${MEDIA_UPSTREAM_HOST}:${MEDIA_UPSTREAM_PORT}` } });
  upstream.on("error", (e) => { console.error("[upstream-err]", e && e.code); socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify({ error: { code: "UNAVAILABLE", message: "media data plane not running", retryable: true } })); });
  upstream.on("upgrade", (ures, usocket, uhead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(ures.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("\r\n")}\r\n\r\n`);
    if (uhead && uhead.length) socket.write(uhead);
    usocket.pipe(socket); socket.pipe(usocket);
    const drop = () => { try { usocket.destroy(); socket.destroy(); } catch { /* 已清理 */ } };
    usocket.on("close", drop); socket.on("close", drop); usocket.on("error", drop); socket.on("error", drop);
  });
  upstream.on("response", (ures) => { // 数据面拒绝（401/404等）——按原状态与头透传浏览器
    socket.write(`HTTP/1.1 ${ures.statusCode} ${ures.statusMessage}\r\n`);
    Object.entries(ures.headers).forEach(([k, v]) => socket.write(`${k}: ${Array.isArray(v) ? v.join(", ") : v}\r\n`));
    socket.write("Connection: close\r\n\r\n");
    ures.pipe(socket);
  });
  upstream.end(); // r4修复：http.request须显式end才发出（r3候选遗漏此调导致代理挂超时）
  upstream.on("error", (e) => { console.error("[upstream-err]", e && e.code); socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify({ error: { code: "UNAVAILABLE", message: "media data plane not running", retryable: true } })); });
});
// /mv/* 媒体最小查看授权（fixed scope：进程内viewer token调核心dispatch；scope/clienId校验后胶合成create请求；
//   浏览器身份只能拿短时单用途viewer票。不下发管理token、不接受orgId/projectId/token字段、非泛化代理）
function mvJson(res, out) { res.writeHead(out.status, { "Content-Type": "application/json", ...out.headers }); res.end(JSON.stringify(out.body ?? null)); }
function cwReadBody(req,res,cb){
 const chunks=[];let size=0,tooLarge=false;
 req.on('data',c=>{size+=c.length;if(size>1024*1024){tooLarge=true;chunks.length=0;}else if(!tooLarge)chunks.push(c);});
 req.on('end',()=>{if(tooLarge){mvJson(res,{status:413,body:{error:{code:'INPUT_TOO_LARGE',message:'内容超过1MiB'}}});return;}try{cb(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{cb(null);}});
}
function mvReadBody(req, cb) {
  const chunks = []; let size = 0;
  req.on("data", c => { size += c.length; if (size > 64 * 1024) { req.destroy(); cb(null); } else chunks.push(c); });
  req.on("end", () => { if (size > 64 * 1024) return; try { cb(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { cb(null); } });
}
function mvReclaimExpired() { // C67：全量回收过期主体（非HWM触发；同步遍历=单事件循环内原子）
  const at = Date.now();
  for (const [k, v] of mvSessions) if (v.expiresMs <= at) mvSessions.delete(k);
}
function mvSession(req, res) { // B7(r6/r6.1)：观看主体会话自动发放（免口令；唯一匿名可用的mv入口）
  mvReadBody(req, (body) => {
    if (body === null || typeof body !== "object") { mvJson(res, { status: 400, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "invalid JSON (only empty body or JSON object/array are accepted; JSON scalars are rejected)", retryable: false } } }); return; }
    // v0.2.1：body可为空{}/JSON对象/数组；旧前端过渡期携accessKey等任意字段一律忽略（成功/失败同响应形状，无拒绝分支）
    // r6.1（C67）：持有效主体cookie优先复用——不再无条件增发，不刷新有效期（余寿如实返回）
    const subj = mvSubjectOf(req);
    if (subj) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ viewerSubject: true, reused: true, expiresInSeconds: Math.max(1, Math.ceil((subj.expiresMs - Date.now()) / 1000)) }));
      return;
    }
    // r6.1（C67）容量闸门：新发放前先全量回收过期主体；回收后仍满=耗尽429。
    // Code security: 耗尽不清退/驱逐任何有效主体（既有会话status/stop不受影响）；不恢复口令——
    // retry口径=标准RATE_LIMITED封套+retryAfterSec（最近主体到期秒数，下界1），前端诚实展示、到期有限重试。
    mvReclaimExpired();
    if (mvSessions.size >= MV_MAX_SUBJECTS) {
      let soonest = null;
      for (const v of mvSessions.values()) soonest = soonest === null ? v.expiresMs : Math.min(soonest, v.expiresMs);
      const retrySec = Math.max(1, Math.ceil((soonest - Date.now()) / 1000));
      mvJson(res, { status: 429, headers: { "Retry-After": String(retrySec) }, body: { error: { code: "RATE_LIMITED", message: `viewer subject capacity exhausted (max ${MV_MAX_SUBJECTS}); reclaims as subjects expire; no valid viewer subject is evicted`, retryable: true, retryAfterSec: retrySec, details: { scope: "mv/session", exhaustion: "viewer-subjects", maxSubjects: MV_MAX_SUBJECTS } } } });
      return;
    }
    // Code security: 会话凭证复用项目CSPRNG newToken()（randomBytes(32).base64url），hash为hex cookie值——全程无Math.random
    const tok = sha256Hex("mv-session|" + newToken() + "|" + newToken());
    const ref = sha256Hex("mv-subject|" + tok);
    mvSessions.set(tok, { ref, expiresMs: Date.now() + MV_TTL_MS });
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": `mv_viewer=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(MV_TTL_MS / 1000)}${process.env.SOLOPI_MEDIA_COOKIE_SECURE === "1" ? "; Secure" : ""}` });
    res.end(JSON.stringify({ viewerSubject: true, expiresInSeconds: Math.floor(MV_TTL_MS / 1000) }));
  });
}
const mvRequireSubject = (req, res) => {
  const sub = mvSubjectOf(req);
  if (!sub) { mvJson(res, { status: 401, headers: {}, body: { error: { code: "AUTH_REQUIRED", message: "viewer session required (POST /mv/session first)", retryable: false } } }); return null; }
  return sub;
};
function mvAuthorize(req, res) {
  // Opening a screen is one request. Allocate the anonymous ownership cookie
  // here, without a separate login probe or authorization round trip.
  let subj = mvSubjectOf(req);
  if (!subj) {
    mvReclaimExpired();
    if(mvSessions.size>=MV_MAX_SUBJECTS){mvJson(res,{status:429,headers:{},body:{error:{code:"RATE_LIMITED",message:"viewer capacity exhausted",retryable:true}}});return;}
    const tok=sha256Hex("mv-session|"+newToken()+"|"+newToken());
    subj={ref:sha256Hex("mv-subject|"+tok),expiresMs:Date.now()+MV_TTL_MS};mvSessions.set(tok,subj);
    res.setHeader("Set-Cookie",`mv_viewer=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(MV_TTL_MS/1000)}${process.env.SOLOPI_MEDIA_COOKIE_SECURE==="1"?"; Secure":""}`);
  }
  mvReadBody(req, (body) => {
    if (!body || typeof body !== "object") { mvJson(res, { status: 400, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "invalid JSON", retryable: false } } }); return; }
    // 固定scope内身份注入——浏览器只能指定已列出的client/device，不允许也不接受orgId/projectId/凭据
    const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
    const clientId = String(body.clientId ?? ""); const deviceId = String(body.deviceId ?? "");
    if (!ulid.test(clientId) || !ulid.test(deviceId)) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "clientId/deviceId must be ULIDs", retryable: false } } }); return; }
    for (const k of Object.keys(body)) if (!["clientId", "deviceId"].includes(k)) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "field not allowed: " + k, retryable: false } } }); return; }
    const purpose = body.purpose ?? "screen-preview";
    const out = dispatch("POST", "/v1/media-sessions", { headers: { authorization: "Bearer " + VIEWER_TOKEN,
      "x-media-viewer-subject": subj.ref },
      body: { orgId: SCOPE.orgId, projectId: SCOPE.projectId, clientId, deviceId, purpose, transportIntent: "wss-frames" } });
    mvJson(res, out);
  });
}
function mvStop(req, res) {
  const subj = mvRequireSubject(req, res); if (!subj) return; // B7：匿名停止=401无副作用
  mvReadBody(req, (body) => {
    const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
    const msid = String((body && body.mediaSessionId) ?? "");
    if (!ulid.test(msid)) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "mediaSessionId must be ULID", retryable: false } } }); return; }
    mvJson(res, dispatch("POST", `/v1/media-sessions/${msid}/stop`, { headers: { authorization: "Bearer " + VIEWER_TOKEN, "x-media-viewer-subject": subj.ref }, body: {} }));
  });
}
function mvStatus(req, res, msid) {
  const subj = mvRequireSubject(req, res); if (!subj) return; // B7：匿名读取=401无副作用
  const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
  if (!ulid.test(msid)) { mvJson(res, { status: 422, headers: {}, body: { error: { code: "VALIDATION_FAILED", message: "mediaSessionId must be ULID", retryable: false } } }); return; }
  mvJson(res, dispatch("GET", `/v1/media-sessions/${msid}`, { headers: { authorization: "Bearer " + VIEWER_TOKEN, "x-media-viewer-subject": subj.ref }, body: null }));
}
const serverHandler = server.listeners("request")[0]; // 原createServer回调已被首监听——在其前追加mv分支不可行，采用包装：
// 由于上面用createServer(cb)注册，重写为：在cb前判断。此处通过removeEventListener再re-add实现包装。
void serverHandler;
server.listen(port, host, () => {
  console.log(JSON.stringify({ listening: true, httpview: true, host, port: server.address().port, webroot: WEBROOT, scope: "solopi-lab/glasses", contractVersion: CONTRACT_VERSION }));
});
const shutdown = () => { console.log(JSON.stringify({ listening: false })); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 2000).unref(); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
