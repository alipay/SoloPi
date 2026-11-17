#!/usr/bin/env node
// SoloPi Lab Server — stage A 本地受控管理CLI（contracts v0.1.4 §0.6/§8）
// 只在本机直接操作数据库文件，不监听网络、不暴露任何管理写API以外的凭据。
// 明文 token 仅在创建时一次性打印到 stdout；库中只存 salt+scrypt 哈希。
// 用法: node src/admincli.mjs --db ./data/lab.db admin init --org-key o --project-key p [--label name]
//       node src/admincli.mjs --db ./data/lab.db admin grant --label n --org-key o [--project-key p] [--ttl-hours N]
//       node src/admincli.mjs --db ./data/lab.db admin revoke --label n
//       node src/admincli.mjs --db ./data/lab.db admin scopes [--label n]
//       node src/admincli.mjs --db ./data/lab.db admin audit list
import { openDatabase, migrate, one, many, run } from "./db.mjs";
import { ulid, newToken, tokenHash, toRfc3339 } from "./util.mjs";
import { readFileSync, statSync } from "node:fs";

function parseArgv(argv) {
  const out = { db: "./data/lab.db", _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") out.db = argv[++i];
    else if (a === "--manifest") out.manifest = argv[++i];
    else if (a === "--org-key") out.orgKey = argv[++i];
    else if (a === "--project-key") out.projectKey = argv[++i];
    else if (a === "--label") out.label = argv[++i];
    else if (a === "--ttl-hours") out.ttlHours = Number.parseInt(argv[++i], 10);
    else if (a === "--token-file") out.tokenFile = argv[++i];
    else out._.push(a);
  }
  return out;
}

// Code security: 环境注入式bootstrap——token来自操作者预先以0600放置的文件；
// 校验文件权限，拒绝过宽权限；CLI不回显该token明文（来源文件即持有人）。
export function loadBootstrapToken(filePath) {
  const st = statSync(filePath);
  if (st.mode & 0o077) throw new Error(`refusing token file with permissive mode: ${filePath}`);
  const token = readFileSync(filePath, "utf8").trim();
  if (token.length < 32) throw new Error("token file content too short");
  return token;
}

export function adminInit(db, cfg) {
  const { orgKey, projectKey, label = "bootstrap" } = cfg;
  const externalToken = cfg.tokenFile ? loadBootstrapToken(cfg.tokenFile) : null;
  const now = Date.now();
  let org = one(db, "SELECT id, org_ulid FROM org WHERE org_key = ?", orgKey);
  if (!org) {
    run(db, "INSERT INTO org(org_ulid, org_key, name, created_at_ms) VALUES (?,?,?,?)", ulid(now), orgKey, orgKey, now);
    org = one(db, "SELECT id, org_ulid FROM org WHERE org_key = ?", orgKey);
  }
  let proj = one(db, "SELECT id, project_ulid FROM project WHERE org_rowid=? AND project_key=?", org.id, projectKey ?? "default");
  if (!proj && projectKey) {
    run(db, "INSERT INTO project(org_rowid, project_ulid, project_key, created_at_ms) VALUES (?,?,?,?)", org.id, ulid(now), projectKey, now);
    proj = one(db, "SELECT id, project_ulid FROM project WHERE org_rowid=? AND project_key=?", org.id, projectKey);
  }
  const token = externalToken ?? newToken(); // CSPRNG生成 或 操作者0600文件注入（§0.6环境注入）
  const salt = Buffer.from(newToken().slice(0, 22), "utf8").toString("base64"); // CSPRNG salt
  const expires_ms = now + 30 * 24 * 3600 * 1000;
  run(db, "INSERT INTO admin_subject(label, token_hash, token_salt, created_at_ms, expires_at_ms) VALUES (?,?,?,?,?)",
      label, tokenHash(token, salt), salt, now, expires_ms);
  const subj = one(db, "SELECT id FROM admin_subject WHERE label = ?", label);
  // bootstrap主体授org级scope（project_rowid NULL，继承该org全部项目 §0.6）
  run(db, "INSERT INTO admin_scope(admin_rowid, org_rowid, project_rowid, granted_at_ms) VALUES (?,?,NULL,?)", subj.id, org.id, now);
  run(db, "INSERT INTO admin_audit(admin_rowid, action, target_json, at_ms) VALUES (?,?,?,?)",
      subj.id, "admin.init", JSON.stringify({ orgKey, projectKey, label }), now);
  return { orgId: org.org_ulid, orgKey, projectId: proj ? proj.project_ulid : null, projectKey: projectKey ?? null, label, token, expiresAt: toRfc3339(expires_ms) };
}

export function adminGrant(db, cfg) {
  const { label, orgKey, projectKey, ttlHours = 168 } = cfg;
  const externalToken = cfg.tokenFile ? loadBootstrapToken(cfg.tokenFile) : null; // 环境注入同§0.6
  const now = Date.now();
  if (one(db, "SELECT id FROM admin_subject WHERE label = ?", label)) throw new Error("label already exists: " + label);
  const org = one(db, "SELECT id, org_ulid FROM org WHERE org_key = ?", orgKey);
  if (!org) throw new Error("org not found: " + orgKey);
  let proj = null, projUlid = null;
  if (projectKey) {
    proj = one(db, "SELECT id, project_ulid FROM project WHERE org_rowid=? AND project_key=?", org.id, projectKey);
    if (!proj) throw new Error("project not found in org: " + projectKey);
    projUlid = proj.project_ulid;
  }
  const token = externalToken ?? newToken();
  const salt = Buffer.from(newToken().slice(0, 22), "utf8").toString("base64");
  const expires_ms = now + ttlHours * 3600 * 1000;
  run(db, "INSERT INTO admin_subject(label, token_hash, token_salt, created_at_ms, expires_at_ms) VALUES (?,?,?,?,?)",
      label, tokenHash(token, salt), salt, now, expires_ms);
  const subj = one(db, "SELECT id FROM admin_subject WHERE label = ?", label);
  // org级授权: project_rowid NULL（继承该org全部项目, §0.6）
  run(db, "INSERT INTO admin_scope(admin_rowid, org_rowid, project_rowid, granted_at_ms) VALUES (?,?,?,?)",
      subj.id, org.id, proj ? proj.id : null, now);
  run(db, "INSERT INTO admin_audit(admin_rowid, action, target_json, at_ms) VALUES (?,?,?,?)",
      subj.id, "admin.grant", JSON.stringify({ label, orgKey, projectKey }), now);
  // Code security: 映射随token同一受控通道一次性输出（W2意见④: grant输出orgId/orgKey/projectId/projectKey）
  return { label, orgId: org.org_ulid, orgKey, projectId: projUlid, projectKey: projectKey ?? null, token, expiresAt: toRfc3339(expires_ms) };
}

export function adminRevoke(db, { label }) {
  const now = Date.now();
  const subj = one(db, "SELECT id FROM admin_subject WHERE label = ? AND revoked_at_ms IS NULL", label);
  if (!subj) throw new Error("admin subject not found or already revoked: " + label);
  run(db, "UPDATE admin_subject SET revoked_at_ms = ? WHERE id = ?", now, subj.id); // DDL触发器保证不可逆
  run(db, "UPDATE admin_scope SET revoked_at_ms = ? WHERE admin_rowid = ? AND revoked_at_ms IS NULL", now, subj.id);
  run(db, "INSERT INTO admin_audit(admin_rowid, action, target_json, at_ms) VALUES (?,?,?,?)",
      subj.id, "admin.revoke", JSON.stringify({ label }), now);
  return { label, revokedAt: toRfc3339(now) };
}

export function adminScopes(db, { label }) {
  const rows = many(db, `
    SELECT s.label, o.org_ulid AS orgId, o.org_key AS orgKey, p.project_ulid AS projectId, p.project_key AS projectKey,
           sa.granted_at_ms, sa.revoked_at_ms
    FROM admin_scope sa
    JOIN admin_subject s ON s.id = sa.admin_rowid
    JOIN org o ON o.id = sa.org_rowid
    LEFT JOIN project p ON p.id = sa.project_rowid
    ${label ? "WHERE s.label = ?" : ""}`, ...(label ? [label] : []));
  return rows.map((r) => ({
    label: r.label, orgId: r.orgId, orgKey: r.orgKey, projectId: r.projectId ?? null, projectKey: r.projectKey ?? null,
    grantedAt: toRfc3339(r.granted_at_ms), revokedAt: toRfc3339(r.revoked_at_ms),
  }));
}

export function adminAuditList(db) {
  return many(db, `
    SELECT a.id, s.label, a.action, a.target_json, a.at_ms
    FROM admin_audit a LEFT JOIN admin_subject s ON s.id = a.admin_rowid ORDER BY a.id`)
    .map((r) => ({ id: r.id, label: r.label ?? null, action: r.action, target: JSON.parse(r.target_json), at: toRfc3339(r.at_ms) }));
}

async function main() {
  const args = parseArgv(process.argv.slice(2));
  const db = openDatabase(args.db);
  migrate(db);
  const [group, cmd] = args._;
  if (group !== "admin") { console.error("usage: admin init|grant|revoke|scopes|audit list"); process.exit(1); }
  try {
    if (cmd === "init") {
      const r = adminInit(db, args);
      // Code security: 外部注入token（--token-file）不回显明文——持有人即源文件；本地生成token仅本次stdout输出
      console.log(JSON.stringify(args.tokenFile ? { ...r, token: "(from-file; NOT reprinted)" } : r));
    } else if (cmd === "grant") {
      const r = adminGrant(db, args);
      // Code security: 外部注入token不回显明文；本地生成token仅本次stdout输出
      console.log(JSON.stringify(args.tokenFile ? { ...r, token: "(from-file; NOT reprinted)" } : r));
    } else if (cmd === "revoke") {
      console.log(JSON.stringify(adminRevoke(db, args)));
    } else if (cmd === "probe-isolate") {
      if (!args.manifest) { console.error("usage: admin probe-isolate --manifest <jsonl>"); process.exit(1); }
      console.log(JSON.stringify(probeIsolate(db, { manifestFile: args.manifest })));
    } else if (cmd === "probe-isolation" && args._[2] === "list") {
      console.log(JSON.stringify(probeIsolationList(db)));
    } else if (cmd === "probe-unisolate") {
      if (!args.manifest) { console.error("usage: admin probe-unisolate --manifest <jsonl>"); process.exit(1); }
      console.log(JSON.stringify(probeUnisolate(db, { manifestFile: args.manifest })));
    } else if (cmd === "scopes") {
      console.log(JSON.stringify(adminScopes(db, args)));
    } else if (cmd === "audit" && args._[2] === "list") {
      console.log(JSON.stringify(adminAuditList(db)));
    } else { console.error("unknown admin command"); process.exit(1); }
  } finally { db.close(); }
}


// ── DG147：测试探针可逆隔离层（受支持机制；处理用户现场102台电脑数据污染，根Issue用户评论授权2026-11-08）──
// 核心行不动：client/enrollment保持原样，"另一个44.7.0已吊销注册"零触碰（DDL终态I2本就禁止复活）。
// 0015新表client_probe_isolation＝隔离事实层：逐行可逆（isolate=INSERT；unisolate=DELETE且DB触发器
// 强制写admin_audit留痕）。RO用户网站面按本表过滤；admin/v1面与历史审计全量可查。
const PROBE_VERSION_MARKERS = new Set(["dg129-server-review", "dg128-deploy-probe", "dg128-deploy-probe2"]);

export function probeIsolate(db, { manifestFile }) {
  const now = Date.now();
  const subj = one(db, "SELECT id FROM admin_subject WHERE revoked_at_ms IS NULL ORDER BY id LIMIT 1");
  if (!subj) throw new Error("isolate requires an active admin subject");
  const lines = readFileSync(manifestFile, "utf-8").split("\n").filter((l) => l.trim());
  const out = { total: lines.length, isolated: 0, skipped: 0, refused: [] };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const line of lines) {
      let m; try { m = JSON.parse(line); } catch { out.refused.push({ line, why: "unparseable" }); continue; }
      const row = one(db, "SELECT client_ulid, status, client_version FROM client WHERE client_ulid = ?", m.clientId);
      if (!row) { out.refused.push({ clientId: String(m.clientId), why: "not found" }); continue; }
      if (!PROBE_VERSION_MARKERS.has(row.client_version)) { out.refused.push({ clientId: row.client_ulid, why: "version marker mismatch: " + row.client_version }); continue; }
      if (m.version !== row.client_version) { out.refused.push({ clientId: row.client_ulid, why: "manifest/db version disagree" }); continue; }
      if (row.status !== "approved") { out.refused.push({ clientId: row.client_ulid, why: "non-approved client (e.g. real revoked registration) is out of scope" }); continue; }
      const prior = one(db, "SELECT 1 FROM client_probe_isolation WHERE client_ulid = ?", row.client_ulid);
      if (prior) { out.skipped++; continue; }
      run(db, "INSERT INTO client_probe_isolation VALUES (?,?,?,?,?)", row.client_ulid, row.client_version, manifestFile, subj.id, now);
      run(db, "INSERT INTO admin_audit(admin_rowid, action, target_json, at_ms) VALUES (?,?,?,?)",
        subj.id, "client.probe-isolate", JSON.stringify({ clientId: row.client_ulid, version: row.client_version, manifest: manifestFile }), now);
      out.isolated++;
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return out;
}

export function probeUnisolate(db, { manifestFile }) {
  const now = Date.now();
  const subj = one(db, "SELECT id FROM admin_subject WHERE revoked_at_ms IS NULL ORDER BY id LIMIT 1");
  if (!subj) throw new Error("unisolate requires an active admin subject");
  const lines = readFileSync(manifestFile, "utf-8").split("\n").filter((l) => l.trim());
  const out = { total: lines.length, unisolated: 0, skipped: 0, refused: [] };
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const line of lines) {
      let m; try { m = JSON.parse(line); } catch { out.refused.push({ line, why: "unparseable" }); continue; }
      const row = one(db, "SELECT client_ulid FROM client_probe_isolation WHERE client_ulid = ?", m.clientId);
      if (!row) { out.refused.push({ clientId: String(m.clientId), why: "no isolation row" }); continue; }
      run(db, "DELETE FROM client_probe_isolation WHERE client_ulid = ?", row.client_ulid); // BEFORE DELETE触发器强制审计留痕
      out.unisolated++;
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return out;
}

export function probeIsolationList(db) {
  return many(db, "SELECT client_ulid, version, manifest_file, isolated_at_ms FROM client_probe_isolation ORDER BY isolated_at_ms, client_ulid");
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("admincli.mjs");
if (invokedDirectly) main();
