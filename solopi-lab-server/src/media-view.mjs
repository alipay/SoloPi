#!/usr/bin/env node
// SoloPi Lab Server — v0.2.0媒体r3独立数据面进程（部署层，服务端负责人独占）
// 有界H264原码透传：Client→viewer 单向二进制帧，不转码、不落盘、无控制/无音频。
// 控制API（serve.mjs）零码流承载：本进程只做票据校验/配对/有界转发/清理。
// Viewer subscriptions end independently; the final viewer releases shared capture.
// Code security: 票据哈希比对入库token_hash；token明文不出现在任何日志；consume为一次性原子UPDATE。
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { WebSocketServer } from "ws";
import { openDatabase, one, run } from "./db.mjs";
import {reapExpiredPendingMedia} from './media-session-recovery.mjs';

import {configureDiagnostics,recordDiagnostic} from './diagnostics.mjs';
import {dirname,join} from 'node:path';
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const DB = flag("db");
const PORT = Number.parseInt(flag("port", "8792"), 10);
const HOST = flag("host", "0.0.0.0");
const SWEEP_MS = Number.parseInt(flag("sweep-interval-ms", "2000"), 10);
const HEARTBEAT_MS = Number.parseInt(flag('heartbeat-interval-ms','25000'),10);
if(!Number.isFinite(HEARTBEAT_MS)||HEARTBEAT_MS<=0)throw Error('heartbeat-interval-ms must be positive');
const MAX_BUFFERED_BYTES = Number.parseInt(flag("max-buffered-bytes", String(2 * 1024 * 1024)), 10);
const MAX_QUEUE_MESSAGES = Number.parseInt(flag("max-queue-messages", "256"), 10);        // B5：消息数上限（app响应同值）
const MAX_SESSIONS = Number.parseInt(flag("max-sessions", "8"), 10);                       // At most eight simultaneous device capture sources; viewers do not consume source slots.
const UPLINK_WINDOW_MS = 1000;
const MAX_UPLINK_BYTES_PER_SEC = Number.parseInt(flag("max-uplink-bytes-per-sec", String(4 * 1024 * 1024)), 10); // B5：带宽上限
if (!DB) { console.error("media-view: --db required"); process.exit(2); }

configureDiagnostics(process.env.SOLOPI_DIAGNOSTICS_DIR||join(dirname(DB),'diagnostics'));
const db = openDatabase(DB);
// B4：进程重启对账——单数据面实例语义下，前进程遗留的live会话不可能有存活连接，如实落终态
run(db, "UPDATE media_session SET status='failed', ended_reason=COALESCE(ended_reason,'media-proc-restart'), ended_at_ms=? WHERE status='live'", Date.now());
reapExpiredPendingMedia(db);
const now = () => Date.now();
const tokenHashOf = (t) => createHash("sha256").update(t, "utf8").digest("base64");
const CLOSE = { DENIED: 4401, PAIR: 4402, GONE: 4404, BACKPRESSURE: 4408, STOPPED: 4409, INTERNAL: 4500 };

// Source registry: one Client uplink and independently authorized viewer subscriptions.
const live = new Map();

// 原子consume：一次性、未吊销、未过期、会话未终结；任一无效即拒（HTTP 401 + X-Media-Deny原因）
function admit(rawTicket) {
  const at = now();
  const token = String(rawTicket ?? "");
  if (!/^[A-Za-z0-9._-]{32,}$/.test(token)) return { consumed: false, reason: "malformed" };
  const t = one(db, `
    SELECT t.id AS ticket_id, t.role, t.expires_at_ms AS ticket_expires, t.revoked_at_ms, t.consumed_at_ms,
           ms.id AS session_id, ms.media_session_ulid, ms.source_session_ulid, ms.status, ms.expires_at_ms AS session_expires, ms.ended_at_ms,
           c.status AS client_status, c.valid_until_ms, d.status AS device_status
    FROM media_ticket t
    JOIN media_session ms ON ms.id = t.media_session_rowid
    JOIN client c ON c.id = ms.client_rowid
    JOIN device d ON d.id = ms.device_rowid
    WHERE t.token_hash = ?`, tokenHashOf(token));
  if (!t) { if (process.env.MEDIA_TRACE) console.error("[admit] unknown-ticket"); return { consumed: false, reason: "unknown-ticket" }; }
  if (t.revoked_at_ms !== null) { if (process.env.MEDIA_TRACE) console.error("[admit] revoked", t.status); return { consumed: false, reason: "revoked" }; }
  if (t.consumed_at_ms !== null) { if (process.env.MEDIA_TRACE) console.error("[admit] reused"); return { consumed: false, reason: "reused" }; }
  if (t.ticket_expires <= at) { if (process.env.MEDIA_TRACE) console.error("[admit] ticket-expired"); return { consumed: false, reason: "ticket-expired" }; }
  if (t.status === "stopped" || t.status === "failed") { if (process.env.MEDIA_TRACE) console.error("[admit] session-ended", t.status); return { consumed: false, reason: "session-ended" }; }
  if (t.session_expires <= at) { if (process.env.MEDIA_TRACE) console.error("[admit] session-expired"); return { consumed: false, reason: "session-expired" }; }
  // B3：入场即核当前Client/设备有效性（与控制面r2判据同源）——吊销后的Client持未吊销票也不得入场
  if (t.client_status === "revoked") { if (process.env.MEDIA_TRACE) console.error("[admit] client-revoked"); return { consumed: false, reason: "client-revoked" }; }
  if (t.valid_until_ms <= at) { if (process.env.MEDIA_TRACE) console.error("[admit] client-expired"); return { consumed: false, reason: "client-expired" }; }
  if (t.device_status !== "online") { if (process.env.MEDIA_TRACE) console.error("[admit] device-offline"); return { consumed: false, reason: "device-offline" }; }
  const upd = run(db, "UPDATE media_ticket SET consumed_at_ms = ? WHERE id = ? AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL AND expires_at_ms > ?",
      at, t.ticket_id, at);
  if (Number(upd.changes) !== 1) return { consumed: false, reason: "race-lost" };     // 并发重放只有一路胜出
  return { consumed: true, row: t };
}

// 事实结束：先写DB终态（断线未知不清S侧权威状态），再断两端、吊销全部剩余票据
function endSessionDb(msid, status, reason) {
  const at = now();
  recordDiagnostic({event:'media.session.end',requestId:msid,status,code:reason});
  run(db, "UPDATE media_session SET status = CASE WHEN status IN ('stopped','failed') THEN status ELSE ? END, ended_reason = COALESCE(ended_reason, ?), ended_at_ms = COALESCE(ended_at_ms, ?) WHERE media_session_ulid = ?",
      status, reason, at, msid);
  run(db, "UPDATE media_ticket SET revoked_at_ms = ? WHERE media_session_rowid = (SELECT id FROM media_session WHERE media_session_ulid = ?) AND revoked_at_ms IS NULL",
      at, msid);
}
function kickAll(msid,code,why){
 const e=live.get(msid);if(!e)return;e.ended=true;
 for(const sock of [e.client,...e.viewers.values()]){try{sock?.close(code,String(why).slice(0,120))}catch{}}
 live.delete(msid);
}
function failSource(msid,status,reason){
 endSessionDb(msid,status,reason);
 for(const row of db.prepare("SELECT media_session_ulid FROM media_session WHERE source_session_ulid=? AND status IN ('authorized','live')").all(msid))endSessionDb(row.media_session_ulid,status,reason);
 kickAll(msid,CLOSE.GONE,reason);
}
function finishSourceIfUnused(msid){
 const count=one(db,"SELECT count(*) n FROM media_session WHERE source_session_ulid=? AND status IN ('authorized','live') AND expires_at_ms>?",msid,now()).n;
 if(count===0){endSessionDb(msid,'stopped','last-viewer-left');kickAll(msid,CLOSE.STOPPED,'last-viewer-left');}
}
function dropViewer(entry,sid,code,reason,status='failed'){
 const viewer=entry.viewers.get(sid);entry.viewers.delete(sid);entry.ready.delete(sid);endSessionDb(sid,status,reason);try{viewer?.close(code,reason)}catch{}finishSourceIfUnused(entry.id);
}
function isIdr(data){for(let i=0;i+3<data.length;i++){let n=-1;if(data[i]===0&&data[i+1]===0&&data[i+2]===1)n=i+3;else if(data[i]===0&&data[i+1]===0&&data[i+2]===0&&data[i+3]===1)n=i+4;if(n>=0&&(data[n]&31)===5)return true;}return false;}

const server = createServer((req, res) => {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "media data plane serves websocket upgrades only", retryable: false } }));
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
// Static screens may emit no H264 data. Protocol pings keep proxy tunnels alive
// without inventing video frames or sending application data from the viewer.
const heartbeat=setInterval(()=>{for(const socket of wss.clients)if(socket.readyState===1)socket.ping();},HEARTBEAT_MS);heartbeat.unref();

server.on("upgrade", (req, socket, head) => {
  const m = /^\/ws\/media\/([A-Za-z0-9._-]{32,})$/.exec(req.url ?? "");
  if (!m) { socket.end("HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n"); return; }
  const verdict = admit(m[1]);
  if (!verdict.consumed) {
    recordDiagnostic({event:'media.admission.failed',code:verdict.reason});
    socket.end(`HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nX-Media-Deny: ${verdict.reason}\r\nConnection: close\r\n\r\n`);
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, verdict.row));
});

function attach(ws,t){
 const sid=t.media_session_ulid,msid=t.source_session_ulid||sid,role=t.role;
 const source=one(db,"SELECT status,expires_at_ms FROM media_session WHERE media_session_ulid=?",msid);
 if(!source||!['authorized','live'].includes(source.status)||source.expires_at_ms<=now()){ws.close(CLOSE.GONE,'source ended');return;}
 let entry=live.get(msid);
 if(!entry){if(live.size>=MAX_SESSIONS){ws.close(CLOSE.GONE,'source capacity');return;}entry={id:msid,client:null,viewers:new Map(),ready:new Set(),gop:[],gopBytes:0,uplinkBytes:0,uplinkWindowStart:now(),ended:false};live.set(msid,entry);}
 if(role==='client'){
  if(entry.client&&entry.client.readyState<=1){ws.close(CLOSE.DENIED,'source already connected');return;}entry.client=ws;
  run(db,"UPDATE media_session SET status='live',client_joined_ms=? WHERE media_session_ulid=?",now(),msid);
  run(db,"UPDATE media_session SET status='live',client_joined_ms=? WHERE source_session_ulid=? AND status='authorized' AND viewer_joined_ms IS NOT NULL",now(),msid);
 }else{
  if(entry.viewers.has(sid)){ws.close(CLOSE.DENIED,'viewer already connected');return;}
  entry.viewers.set(sid,ws);
  run(db,"UPDATE media_session SET viewer_joined_ms=?,client_joined_ms=?,status=? WHERE media_session_ulid=?",now(),entry.client?now():null,entry.client?'live':'authorized',sid);
  if(entry.gop.length){for(const frame of entry.gop)ws.send(frame,{binary:true});entry.ready.add(sid);}
 }
 ws.on('message',(data,binary)=>{
  if(entry.ended)return;
  if(role==='viewer'){dropViewer(entry,sid,CLOSE.DENIED,'viewer-sent-data');return;}
  if(!binary){failSource(msid,'failed','client-protocol');return;}
  const at=now();if(at-entry.uplinkWindowStart>=UPLINK_WINDOW_MS){entry.uplinkWindowStart=at;entry.uplinkBytes=0;}entry.uplinkBytes+=data.length;
  if(entry.uplinkBytes>MAX_UPLINK_BYTES_PER_SEC){failSource(msid,'failed','uplink-rate');return;}
  const key=isIdr(data);
  if(key){entry.gop=[];entry.gopBytes=0;}
  if(key||entry.gop.length){entry.gop.push(Buffer.from(data));entry.gopBytes+=data.length;if(entry.gopBytes>MAX_BUFFERED_BYTES||entry.gop.length>MAX_QUEUE_MESSAGES){entry.gop=[];entry.gopBytes=0;}}
  for(const [id,viewer] of entry.viewers){
   if(viewer.readyState!==1)continue;
   if(viewer.bufferedAmount>MAX_BUFFERED_BYTES){dropViewer(entry,id,CLOSE.BACKPRESSURE,'viewer backpressure');continue;}
   if(key)entry.ready.add(id);
   if(entry.ready.has(id))viewer.send(data,{binary:true},err=>{if(err&&!entry.ended)dropViewer(entry,id,CLOSE.GONE,'viewer send failed')});
  }
 });
 ws.on('close',()=>{
  if(entry.ended)return;
  if(role==='client'){failSource(msid,'failed','client-closed');return;}
  if(entry.viewers.get(sid)===ws){entry.viewers.delete(sid);entry.ready.delete(sid);endSessionDb(sid,'stopped','viewer-closed');finishSourceIfUnused(msid);}
 });
 ws.on('error',()=>{try{ws.terminate()}catch{}});
}

// sweep：控制面stop/过期以DB为单一事实源，最迟SWEEP_MS传导到连接
function sweep(){
 const at=now();
 reapExpiredPendingMedia(db,at);
 for(const [msid,e] of live){
  for(const row of db.prepare("SELECT media_session_ulid FROM media_session WHERE source_session_ulid=? AND status IN ('authorized','live') AND expires_at_ms<=?").all(msid,at))endSessionDb(row.media_session_ulid,'expired','expired');
  for(const [sid,sock] of e.viewers){const v=one(db,"SELECT status,expires_at_ms FROM media_session WHERE media_session_ulid=?",sid);if(!v||!['authorized','live'].includes(v.status)||v.expires_at_ms<=at){e.viewers.delete(sid);e.ready.delete(sid);if(v&&v.expires_at_ms<=at)endSessionDb(sid,'expired','expired');try{sock.close(CLOSE.STOPPED,'viewer ended')}catch{}}}
  const m=one(db,"SELECT ms.status,ms.expires_at_ms,c.status client_status,c.valid_until_ms,d.status device_status FROM media_session ms JOIN client c ON c.id=ms.client_rowid JOIN device d ON d.id=ms.device_rowid WHERE ms.media_session_ulid=?",msid);
  if(!m){kickAll(msid,CLOSE.GONE,'source missing');continue;}
  if(!['authorized','live'].includes(m.status)){failSource(msid,m.status,'source ended');continue;}
  if(m.client_status==='revoked'||m.valid_until_ms<=at||m.device_status!=='online'){failSource(msid,'failed','source unavailable');continue;}
  if(m.expires_at_ms<=at){failSource(msid,'expired','expired');continue;}
  finishSourceIfUnused(msid);
 }
}

setInterval(sweep, SWEEP_MS).unref(); // server监听句柄持有事件循环；sweep仅护航断线清理

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ listening: true, mediaView: true, host: HOST, port: server.address().port, mode: "wss-relay", binary: "client->viewer", maxBufferedBytes: MAX_BUFFERED_BYTES, sweepIntervalMs: SWEEP_MS }));
});
const shutdown = (sig) => {
  console.error("MEDIA-VIEW-SHUTDOWN signal=", sig, "live=", live.size);
  // B4：关闭即落终态——live会话随进程亡，不能在DB留live（对账责任在数据面自身）
  const at = now();
  const msids = [...live.keys()];
  run(db, "UPDATE media_session SET status='failed', ended_reason=COALESCE(ended_reason,'media-proc-stop'), ended_at_ms=? WHERE status='live'", at);
  for (const msid of msids) { try { run(db, "UPDATE media_ticket SET revoked_at_ms=? WHERE media_session_rowid=(SELECT id FROM media_session WHERE media_session_ulid=?) AND revoked_at_ms IS NULL", at, msid); } catch { /* 收尾尽力 */ } }
  for (const msid of msids) kickAll(msid, CLOSE.STOPPED, "server shutdown");
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT")); process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGPIPE", () => console.error("MEDIA-VIEW-SIGPIPE"));
