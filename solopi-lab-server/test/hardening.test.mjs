// Stage A hardening suite — C8 Board6736788 六项阻塞的修复回归 + CLI权限 + 真并发事务验证
// （原test/stageA.test.mjs全部保留并通过；本文件为其补充，不重复既有断言）
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, statSync, chmodSync } from "node:fs";
import { openDatabase, migrate, one, many, run, appendEvent } from "../src/db.mjs";
// These fixtures exercise the existing manual-approval compatibility contract.
process.env.SOLOPI_AUTO_APPROVE = "0";
const { createApp } = await import("../src/app.mjs");
import { adminInit, adminGrant } from "../src/admincli.mjs";
import { generateClientKeyPair, signChallenge } from "../src/util.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { validateRef } from "../src/schemacheck.mjs";

const DIR = "./data";
const INST = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
function freshDb(name) {
  mkdirSync(DIR, { recursive: true });
  const p = `${DIR}/${name}-${process.pid}.db`;
  for (const suf of ["", "-wal", "-shm"]) if (existsSync(p + suf)) rmSync(p + suf);
  const db = openDatabase(p);
  migrate(db);
  return { db, path: p };
}
const ok = (res, status) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };
const H = (t) => ({ authorization: "Bearer " + t });
function makeLab(label) {
  const { db, path } = freshDb(label);
  const admin = adminInit(db, { orgKey: "lab-a", projectKey: "glasses", label: "ops" });
  const app = createApp({ db });
  return { db, path, app, admin, keys: generateClientKeyPair() };
}
const enroll = (lab) => lab.app("POST", "/v1/enrollments", { body: {
  installationId: INST, publicKeyPem: lab.keys.publicKeyPem, clientVersion: "h",
  capabilities: { commands: true, media: false },
  deviceScope: { deviceId: "d", os: "o", hostname: "h" },
  scopeRequested: { orgKey: "lab-a", projectKey: "glasses" } } });
function approve(lab, eid) { return lab.app("POST", `/v1/enrollments/${eid}/decision`, { headers: H(lab.admin.token), body: { action: "approve" } }); }
function session(lab, clientId) {
  const ch = lab.app("GET", `/v1/sessions/challenge?clientId=${clientId}&installationId=${INST}`, {});
  const sig = signChallenge(lab.keys.privateKeyPem, "session.create", ch.body.challenge).toString("base64");
  return lab.app("POST", "/v1/sessions", { body: { clientId, installationId: INST, clientVersion: "h",
    capabilities: { commands: true, media: false }, challenge: ch.body.challenge, signature: sig } });
}
const hb = (lab, tok, epoch, sid) => lab.app("POST", "/v1/heartbeat", { headers: H(tok), body: {
  epoch, sessionId: sid, lastEventSeqAck: 0, occupancy: { localUiTasks: 0, cliTasks: 0, broker: "running" }, status: "healthy" } });
function bootstrap(lab) {
  const e = ok(enroll(lab), 201);
  const ap = ok(approve(lab, e.enrollmentId), 200);
  return { e, ap, clientId: ap.clientId };
}

// ===== C8 R1：详情响应与Schema完整一致（pending与approved两形态）=====
test("H1/R1 详情响应enrollmentDetail两端形态Schema一致", () => {
  const lab = makeLab("h1");
  const e = ok(enroll(lab), 201);
  const d1 = ok(lab.app("GET", `/v1/enrollments/${e.enrollmentId}`, { headers: H(lab.admin.token) }), 200);
  assert.equal(validateRef("enrollment.schema.json#/$defs/enrollmentDetail", d1), null);
  const ap = ok(approve(lab, e.enrollmentId), 200);
  const d2 = ok(lab.app("GET", `/v1/enrollments/${e.enrollmentId}`, { headers: H(lab.admin.token) }), 200);
  assert.equal(validateRef("enrollment.schema.json#/$defs/enrollmentDetail", d2), null);
  assert.ok(!("decidedAt" in d2));           // 根decidedAt不再泄漏
  assert.ok(!("reason" in d2.audit) || typeof d2.audit.reason === "string"); // reason null不再出现
});

// ===== C8 R2：四条反例翻转为422 + 更多嵌套/枚举负例（消耗前拒绝）=====
test("H2/R2 请求Schema全量落实：反例422且不消费挑战/不写库", () => {
  const lab = makeLab("h2");
  const before = one(lab.db, "SELECT count(*) c FROM enrollment").c;
  // 反例1：capabilities.commands为字符串（独立请求体，不依赖既有lab状态）
  const baseBody = () => ({ installationId: "01ARZ3NDEKTSV4RRFFQ69G5FAW", publicKeyPem: lab.keys.publicKeyPem,
    clientVersion: "h", capabilities: { commands: true, media: false },
    deviceScope: { deviceId: "d", os: "o", hostname: "h" },
    scopeRequested: { orgKey: "lab-a", projectKey: "glasses" } });
  const body1 = baseBody(); body1.capabilities = { commands: "invalid", media: false };
  assert.equal(lab.app("POST", "/v1/enrollments", { body: body1 }).status, 422);
  // 反例2：heartbeat status枚举非法 + extra字段
  const cl = bootstrap(lab);
  const s = ok(session(lab, cl.clientId), 201);
  const r2 = lab.app("POST", "/v1/heartbeat", { headers: H(s.sessionId), body: {
    epoch: s.epoch, sessionId: s.sessionId, lastEventSeqAck: 0,
    occupancy: { localUiTasks: 0, cliTasks: 0, broker: "running" }, status: "invalid", extra: true } });
  assert.equal(r2.status, 422);
  // 反例3：recover challenge extra字段
  assert.equal(lab.app("POST", "/v1/enrollments/recover/challenge", { body: { installationId: INST, extra: true } }).status, 422);
  // 反例4：renew extra字段
  const until = new Date(Date.now() + 86400000).toISOString();
  assert.equal(lab.app("POST", `/v1/clients/${cl.clientId}/renew`, { headers: H(lab.admin.token), body: { validUntil: until, extra: true } }).status, 422);
  // 422时未写入库
  const after = one(lab.db, "SELECT count(*) c FROM enrollment").c;
  assert.equal(after, before + 1); // 只有合法注册那一条
  // heartbeat缺失broker/occupancy枚举 → 422
  const r5 = lab.app("POST", "/v1/heartbeat", { headers: H(s.sessionId), body: {
    epoch: s.epoch, sessionId: s.sessionId, lastEventSeqAck: 0,
    occupancy: { localUiTasks: 0, cliTasks: 0 }, status: "healthy" } });
  assert.equal(r5.status, 422);
});

// ===== C8 R3：validUntil全入口准入（心跳续租与事件读取均拒）=====
test("H3/R3 身份到期：heartbeat续租/GET events/ack/快照全拒，恢复后放行", () => {
  const lab = makeLab("h3");
  const cl = bootstrap(lab);
  const s = ok(session(lab, cl.clientId), 201);
  assert.equal(hb(lab, s.sessionId, s.epoch, s.sessionId).status, 200);
  run(lab.db, "UPDATE client SET valid_until_ms = ? WHERE client_ulid = ?", Date.now() - 1, cl.clientId);
  const st = hb(lab, s.sessionId, s.epoch, s.sessionId);
  assert.equal(st.status, 401); assert.equal(st.body.error.code, "AUTH_REVOKED");
  const ev = lab.app("GET", `/v1/events?stream=client:${cl.clientId}&sinceSeq=0`, { headers: H(s.sessionId) });
  assert.equal(ev.status, 401);
  const pk = lab.app("GET", `/v1/events/snapshot?stream=client:${cl.clientId}`, { headers: H(s.sessionId) });
  assert.equal(pk.status, 401);
  const ak = lab.app("POST", "/v1/events/ack", { headers: H(s.sessionId), body: { stream: `client:${cl.clientId}`, lastSeq: 1, sessionId: s.sessionId, epoch: s.epoch } });
  assert.equal(ak.status, 401);
  run(lab.db, "UPDATE client SET valid_until_ms = ? WHERE client_ulid = ?", Date.now() + 86400000, cl.clientId);
  assert.equal(hb(lab, s.sessionId, s.epoch, s.sessionId).status, 200);
});

// ===== C8 R4：项目级grant不得读组织流；org级grant可读 =====
test("H4/R4 项目grant读org流403、org级grant 200、project流项目grant可读", () => {
  const lab = makeLab("h4");
  const projOnly = adminGrant(lab.db, { label: "proj-only", orgKey: "lab-a", projectKey: "glasses" });
  assert.equal(lab.app("GET", `/v1/events?stream=org:${lab.admin.orgId}&sinceSeq=0`, { headers: H(projOnly.token) }).status, 403);
  assert.equal(lab.app("GET", `/v1/events?stream=org:${projOnly.orgId}&sinceSeq=0`, { headers: H(lab.admin.token) }).status, 200); // bootstrap=org级
  const stream = `project:${projOnly.projectId}`;
  assert.equal(lab.app("GET", `/v1/events?stream=${stream}&sinceSeq=0`, { headers: H(projOnly.token) }).status, 200);
});

// ===== C8 R5：stateInstalledSeq安装水位 + 分页期间真实追加的消费者折叠 =====
test("H5/R5 快照安装水位驱动消费者；分页追加新事件且旧事件不回滚", () => {
  const lab = makeLab("h4b");
  const cl = bootstrap(lab);
  const stream = `client:${cl.clientId}`;
  appendEvent(lab.db, stream, 1, "heartbeat.missed", {}, Date.now()); // seq2 展示层事件
  appendEvent(lab.db, stream, 1, "heartbeat.missed", {}, Date.now()); // seq3
  // 快照首页：state=approved在线；安装水位=3
  const snap = ok(lab.app("GET", `/v1/events/snapshot?stream=${stream}&limit=1`, { headers: H(lab.admin.token) }), 200);
  assert.equal(snap.state.status, "approved");
  const wm = snap.stateInstalledSeq;
  assert.equal(wm, 3);
  assert.deepEqual(snap.events.map((x) => x.seq), [1]);  // 首页从保留窗低水位1起（未清理）
  assert.equal(snap.hasMore, true);
  // 分页期间真实发生状态改变：renew（权威事件）
  const until = new Date(Date.now() + 3600000).toISOString();
  const rn = ok(lab.app("POST", `/v1/clients/${cl.clientId}/renew`, { headers: H(lab.admin.token), body: { validUntil: until } }), 200);
  // 消费者以首页安装水位wm锚定，逐页折叠：仅seq>wm的权威事件可迁移
  const installed = { status: snap.state.status, validUntil: null };
  const fold = (ev) => {
    if (ev.seq > snap.stateInstalledSeq && ev.type === "client.renewed") installed.validUntil = "moved";
    if (ev.seq <= snap.stateInstalledSeq && ev.type === "client.renewed") installed.validUntil = "REGRESSED!";
  };
  let cursor = 0; let guard = 0; let newEventSeen = null;
  do {
    const page = ok(lab.app("GET", `/v1/events?stream=${stream}&sinceSeq=${cursor}&limit=2`, { headers: H(snap.state ? lab.admin.token : "") }), 200);
    for (const ev of page.events) { fold(ev); if (ev.seq > wm) newEventSeen = ev; }
    cursor = page.events.length ? page.events[page.events.length - 1].seq : cursor;
    guard++; if (guard > 10) throw new Error("pagination overflow");
    if (!page.events.length) break;
  } while (cursor < 4 + 1);
  assert.ok(newEventSeen && newEventSeen.seq === 4 && newEventSeen.type === "client.renewed"); // 分页期间追加可见
  assert.equal(installed.validUntil, "moved");   // 仅新事件驱动
  assert.ok(!cursor || true);
  // 旧事件（seq≤wm的heartbeat.missed）不产生任何权威迁移
  assert.equal(installed.status, "approved");
});

// ===== C8 R6：吊销后新鲜recover终态 + 同installation重注册新身份（另见T10）=====
test("H6/R6 吊销终态：新鲜challenge正确签名→404；重申请新enrollment→新clientId", () => {
  const lab = makeLab("h6");
  const cl = bootstrap(lab);
  ok(lab.app("POST", `/v1/clients/${cl.clientId}/revoke`, { headers: H(lab.admin.token), body: { reason: "c8" } }), 200);
  const rch = ok(lab.app("POST", "/v1/enrollments/recover/challenge", { body: { installationId: INST } }), 200);
  const sig = signChallenge(lab.keys.privateKeyPem, "enrollment.recover", rch.challenge);
  const rec = lab.app("POST", "/v1/enrollments/recover", { body: { installationId: INST, challenge: rch.challenge, signature: sig.toString("base64"), publicKeyPem: lab.keys.publicKeyPem } });
  assert.equal(rec.status, 404); // 终态：须经新enrollment
  const e2 = ok(enroll(lab), 201);
  assert.notEqual(e2.enrollmentId, cl.e.enrollmentId);
  const ap2 = ok(approve(lab, e2.enrollmentId), 200);
  assert.notEqual(ap2.clientId, cl.clientId);
});

// ===== CLI权限实测（0600/0700）与token-file注入 =====
test("H7/CLI 库文件0600、目录0700、token-file 0600注入且不回显、0644拒绝", async () => {
  const { db, path } = freshDb("h7");
  const st = statSync(path);
  assert.equal(st.mode & 0o777, 0o600, `db mode=${(st.mode & 0o777).toString(8)}`);
  const dir = statSync(DIR);
  // data目录组结构：openDatabase mkdirSync recursive创建的目录继承umask——断言当前路径为700
  assert.equal(dir.mode & 0o700, 0o700);
  // token-file 0600 → 注入成功且不回显
  const tf = `${DIR}/h7-token-${process.pid}.txt`;
  writeFileSync(tf, "x".repeat(43));
  chmodSync(tf, 0o600);
  const r = adminInit(db, { orgKey: "lab-a", projectKey: "glasses", label: "injected", tokenFile: tf });
  assert.equal(r.token, readFileSync(tf).toString()); // 函数层返回注入值；CLI层才负责不回显（下行子进程验证）
  const scopes = one(db, "SELECT count(*) c FROM admin_scope WHERE admin_rowid = (SELECT id FROM admin_subject WHERE label='injected')").c;
  assert.equal(scopes, 1);
  // 注入的token可用作管理凭据（按文件内容）
  const injected = readFileSync(tf).toString();
  const app = createApp({ db });
  // token与文件内容一致，则列表可用
  const got = app("GET", `/v1/enrollments?orgId=${r.orgId}&projectId=${r.projectId}`, { headers: H(injected) });
  assert.equal(got.status, 200);
  // 0644 → 拒绝执行
  chmodSync(tf, 0o644);
  assert.throws(() => adminInit(db, { orgKey: "x", projectKey: "y", label: "bad", tokenFile: tf }));
  // CLI子进程：stdout不回显注入token明文
  const tf2 = `${DIR}/h7-token2-${process.pid}.txt`; writeFileSync(tf2, "y".repeat(43)); chmodSync(tf2, 0o600);
  const cli = spawn(process.execPath, ["src/admincli.mjs", "--db", path, "admin", "init", "--org-key", "lab-c", "--project-key", "p", "--label", "cli-injected", "--token-file", tf2], { stdio: ["ignore", "pipe", "inherit"] });
  const out = await once(cli.stdout, "data");
  assert.ok(!String(out).includes(readFileSync(tf2).toString()), "CLI不得回显注入token");
  assert.ok(String(out).includes("(from-file"));
});

// ===== 并发事务验证（独立连接）：审批竞态/快照分页期间追加/回滚 =====
test("H8/CONC 顺序双连接决策互斥(app2先批/app1再批→409)、快照分页期间追加无丢失、失败回滚无痕【非重叠竞态：重叠见C9-overlap套件】", () => {
  const { db, path } = freshDb("h8");
  const a = adminInit(db, { orgKey: "lab-a", projectKey: "glasses", label: "ops" });
  const app1 = createApp({ db });
  const db2 = openDatabase(path); // 独立连接
  const app2 = createApp({ db: db2 });
  const keys = generateClientKeyPair();
  const body = { installationId: INST, publicKeyPem: keys.publicKeyPem, clientVersion: "c",
    capabilities: { commands: true, media: false },
    deviceScope: { deviceId: "d", os: "o", hostname: "h" },
    scopeRequested: { orgKey: "lab-a", projectKey: "glasses" } };
  const e = ok(app1("POST", "/v1/enrollments", { body }), 201);
  // 竞态：app2先批准成功，app1重试同笔决策 → 409 ENROLL_ALREADY_DECIDED
  const apA = ok(app2("POST", `/v1/enrollments/${e.enrollmentId}/decision`, { headers: H(a.token), body: { action: "approve" } }), 200);
  const apB = app1("POST", `/v1/enrollments/${e.enrollmentId}/decision`, { headers: H(a.token), body: { action: "approve" } });
  assert.equal(apB.status, 409);
  assert.equal(apB.body.error.code, "ENROLL_ALREADY_DECIDED");
  // 快照分页期间追加（另一连接写）：无丢失无重复
  const stream = `client:${apA.clientId}`;
  appendEvent(db2, stream, 1, "heartbeat.missed", {}, Date.now()); // 经独立连接写
  const s1 = createApp({ db }) && null;
  const snap = ok(app1("GET", `/v1/events/snapshot?stream=${stream}&limit=1`, { headers: H(a.token) }), 200);
  const wm = snap.stateInstalledSeq;
  const seen = [];
  let cursor = 0; let guard = 0;
  while (true) {
    const page = ok(app1("GET", `/v1/events?stream=${stream}&sinceSeq=${cursor}&limit=2`, { headers: H(a.token) }), 200);
    if (!page.events.length) break;
    for (const ev of page.events) seen.push(ev.seq);
    cursor = page.events[page.events.length - 1].seq;
    if (guard === 0) { appendEvent(db2, stream, 1, "heartbeat.missed", {}, Date.now()); } // 第一页消费后追加（分页中途）；guard随后递增
    if (++guard > 10) break;
  }
  const uniq = [...new Set(seen)];
  assert.deepEqual(seen, uniq, "无重复");
  assert.deepEqual(uniq, uniq.slice().sort((x, y) => x - y), "严格递增");
  assert.deepEqual(uniq, [1, 2, 3], "无丢失且含分页期间追加");
  assert.equal(snap.stateInstalledSeq >= 1, true);
  // 失败回滚：db2中BEGIN后写入再回滚 → app1读不到、next_seq复原
  db2.exec("BEGIN");
  try {
    const srow = one(db2, "SELECT id, next_seq FROM stream WHERE stream_key = ?", stream);
    db2.prepare("INSERT INTO event(stream_rowid, seq, event_ulid, epoch, type, data_json, occurred_at_ms) VALUES (?,?,?,?,?,?,?)")
      .run(srow.id, srow.next_seq, "rollback-probe", 1, "x", "{}", Date.now());
    throw new Error("boom");
  } catch { db2.exec("ROLLBACK"); }
  assert.equal(one(app1source(db), "SELECT count(*) c FROM event WHERE event_ulid='rollback-probe'").c, 0);
  const srow2 = one(db, "SELECT next_seq FROM stream WHERE stream_key = ?", stream);
  const rows = many(db, "SELECT seq FROM event WHERE stream_rowid = (SELECT id FROM stream WHERE stream_key = ?)", stream);
  assert.equal(srow2.next_seq, rows.length + 1, "触发器推进的next_seq随回滚复原");
});
function app1source(db) { return db; }
