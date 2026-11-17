// SoloPi Lab Server — stage A database layer (node:sqlite built-in, zero deps)
// DDL: migrations/*.sql applied incrementally via schema_migrations; never destructively.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync, chmodSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// Code security: 库文件包含scrypt哈希等敏感材料——新库文件强制0600、库目录强制0700
export function openDatabase(dbPath) {
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });
  try { chmodSync(dir, 0o700); } catch { /* 已存在且受限目录可能由宿主管理；测试断言新创建路径 */ }
  const db = new DatabaseSync(dbPath);
  try { chmodSync(dbPath, 0o600); } catch { /* 只读场景不适用 */ }
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;"); // 多连接写竞争退避（WAL下写仍单写者串行）
  return db;
}

export function migrate(db) {
  const names = readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort();
  let have;
  try {
    have = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
  } catch {
    have = new Set(); // 尚未应用任何迁移（首次建库）
  }
  for (const name of names) {
    const version = Number.parseInt(name.split("_")[0], 10);
    if (!Number.isInteger(version) || version < 1) throw new Error("bad migration name: " + name);
    if (have.has(version)) continue;
    // Code security: 迁移仅执行随代码版本化交付的 .sql，不接受任何外部输入内容
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(join(MIGRATIONS_DIR, name), "utf8")); // runs under the open transaction
      db.prepare("INSERT INTO schema_migrations(version, name, applied_at_ms) VALUES (?,?,?)").run(version, name, Date.now());
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  return names.length;
}

export function currentMigrationVersion(db) {
  const r = db.prepare("SELECT max(version) v FROM schema_migrations").get();
  return r && r.v ? r.v : 0;
}

// -- statement helpers (parameterized only) --------------------------------
export function one(db, sql, ...args) {
  const r = db.prepare(sql).all(...args); // throws >2^53 ints rather than losing precision (verified)
  return r.length ? r[0] : null;
}
export function first(db, sql, ...args) { return one(db, sql, ...args); }
export function many(db, sql, ...args) { return db.prepare(sql).all(...args); }
export function run(db, sql, ...args) { return db.prepare(sql).run(...args); }

// -- stream/event append (contracts §5, DDL triggers enforce contiguity) ----
import { ulid as _ulid } from "./util.mjs"; // local import to avoid cycles in bundlers

export function getOrCreateStream(db, streamKey, nowMs) {
  let s = one(db, "SELECT id, low_watermark_seq FROM stream WHERE stream_key = ?", streamKey);
  if (!s) {
    run(db, "INSERT INTO stream(stream_key, created_at_ms) VALUES (?,?)", streamKey, nowMs);
    s = one(db, "SELECT id, low_watermark_seq FROM stream WHERE stream_key = ?", streamKey);
  }
  return s;
}

export function appendEvent(db, streamKey, epoch, type, data, nowMs) {
  // stream row must exist first (INSERT trigger reads stream.next_seq)
  const s = getOrCreateStream(db, streamKey, nowMs);
  const eventUlid = _ulid(nowMs);
  // seq omitted: DDL only allows seq == stream.next_seq, so read it and pass explicitly for clarity
  const nextSeq = first(db, "SELECT next_seq FROM stream WHERE id = ?", s.id).next_seq;
  run(
    db,
    "INSERT INTO event(stream_rowid, seq, event_ulid, epoch, type, data_json, occurred_at_ms) VALUES (?,?,?,?,?,?,?)",
    s.id, nextSeq, eventUlid, epoch, type, JSON.stringify(data ?? {}), nowMs,
  );
  return { seq: nextSeq, eventId: eventUlid };
}
