#!/usr/bin/env node
// SoloPi Lab Server — stage A 入口（受控联调：独立端口+受信TLS；CORS仅精确origin白名单）
// TLS: --tls-cert/--tls-key 启用HTTPS。证书链/主机名校验交给客户端（curl --cacert/浏览器信任锚），
//       服务端不提供、不接受任何绕过校验的消息。私钥文件建议0600。
// CORS: SOLOPI_CORS_ORIGINS（逗号分隔精确origin）——预检204仅对白名单origin；响应头精确匹配回显，
//       不使用通配符，不开credentials（token走Authorization头，不涉cookie）。
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { createApp, CONTRACT_VERSION } from "./app.mjs";
import { openDatabase, migrate } from "./db.mjs";

import {configureDiagnostics,observeRequest,recordDiagnostic} from './diagnostics.mjs';
import {dirname,join} from 'node:path';
const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : def; }
const dbPath = arg("db", "./data/lab.db");
const port = Number.parseInt(arg("port", "0"), 10);
const host = arg("host", "127.0.0.1");
const tlsCert = arg("tls-cert", null);
const tlsKey = arg("tls-key", null);

// Code security: CORS精确origin白名单（来自环境的可信配置；逐字串匹配，不做子域/通配放行）
const CORS_ORIGINS = (process.env.SOLOPI_CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const corsAllowed = (origin) => CORS_ORIGINS.length > 0 && CORS_ORIGINS.includes(String(origin));
const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-ID",
  "Access-Control-Max-Age": "600",
  "Access-Control-Expose-Headers": "X-Request-ID, Server-Timing",
};

const db = openDatabase(dbPath);
migrate(db);
const dispatch = createApp({ db });

const MAX_BODY = 1_000_000;
configureDiagnostics(process.env.SOLOPI_DIAGNOSTICS_DIR||join(dirname(dbPath),'diagnostics'));
const handler = (req, res) => {
  observeRequest(req,res,'control-plane');
  const origin = req.headers.origin;
  const outCors = origin && corsAllowed(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", ...CORS_HEADERS } : {};
  if (req.method === "OPTIONS") {
    // 预检：仅白名单origin放行；非白名单不带CORS头（浏览器侧拒绝），204静默
    res.writeHead(origin && corsAllowed(origin) ? 204 : 204, outCors);
    res.end();
    return;
  }
  const chunks = [];
  let size = 0;
  req.on("data", (ch) => { size += ch.length; if (size > MAX_BODY) { res.writeHead(413); res.end(); req.destroy(); } else chunks.push(ch); });
  req.on("end", () => {
    let body = null;
    if (chunks.length) {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { body = raw ? JSON.parse(raw) : null; } catch { res.writeHead(400, { "X-Solopi-Contract-Version": CONTRACT_VERSION }); res.end(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "invalid JSON", retryable: false } })); return; }
    }
    let out;
    try {
      out = dispatch(req.method, req.url, { headers: req.headers, body });
    } catch(e) { recordDiagnostic({event:'http.dispatch.failed',code:e.code||e.name||'INTERNAL'});out = { status: 500, headers: {}, body: { error: { code: "INTERNAL", message: "internal error", retryable: true } } }; }
    const payload = JSON.stringify(out.body ?? null);
    res.writeHead(out.status, { "Content-Type": "application/json", ...out.headers, ...outCors });
    res.end(payload);
  });
};

let server;
if (tlsCert && tlsKey) {
  if (!existsSync(tlsCert) || !existsSync(tlsKey)) { console.error(JSON.stringify({ listening: false, error: "tls files missing" })); process.exit(1); }
  server = createTlsServer({ cert: readFileSync(tlsCert), key: readFileSync(tlsKey) }, handler);
} else {
  server = createServer(handler);
}

server.listen(port, host, () => {
  const a = server.address();
  console.log(JSON.stringify({ listening: true, tls: Boolean(tlsCert), host, port: a.port, db: dbPath, contractVersion: CONTRACT_VERSION, corsOrigins: CORS_ORIGINS.length }));
});
const shutdown = () => { console.log(JSON.stringify({ listening: false })); server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 2000).unref(); };
process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
