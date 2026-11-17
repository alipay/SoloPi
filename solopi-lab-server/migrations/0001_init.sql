-- Source: contracts/v0.1.4/ddl.sql (byte-identical payload; base from v0.1.2 with v0.1.3 I7'/I8 + org-level scope)
-- SoloPi Lab Server 阶段A SQLite DDL — contracts v0.1.2（回应C4：静态能保证的进DDL，动态的写进写入口不变量）
-- 迁移规则：schema_migrations 逐版本先行；只允许新增表、字段和索引的增量迁移。
-- 主键：`INTEGER PRIMARY KEY AUTOINCREMENT`（SQLite 64位有符号=BIGINT语义；字面 BIGINT 不成 rowid 别名、不自增，弃用，见 sqlite-ddl.md 实测）。
-- v0.1.2 语义升级：
--   * 全部数值/时间列以 `CHECK(typeof(col)='integer')` 强类型化（SQLite 动态类型下仍拒绝 TEXT 写入，任何版本可用，不依赖 STRICT/3.37+）；
--   * 吊销/消费不可逆、client 状态不可逆 → BEFORE UPDATE 触发器强制（不再宣称"靠写规约"）；
--   * 事件 seq 无洞且单调、session epoch 严格 +1、旧会话即时作废、ack 游标不回退 → 触发器在库层强制；
--   * admin_scope 的 org/project 一致性 → project(org_rowid,id) 复合唯一键 + 复合外键；
--   * admin_subject 增加有效期列。

PRAGMA foreign_keys = ON;

-- 通用约定：毫秒列名 *_at_ms / *_until_ms；epoch/seq 上界 2^53-1 由合同Schema强制，库层再加 CHECK 正性/类型。

CREATE TABLE IF NOT EXISTS schema_migrations (
  version       INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL,
  applied_at_ms INTEGER NOT NULL,
  CHECK (typeof(version)='integer' AND version >= 1),
  CHECK (typeof(applied_at_ms)='integer' AND applied_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS org (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_ulid      TEXT NOT NULL CHECK (typeof(org_ulid)='text'),
  org_key       TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer' AND created_at_ms >= 0),
  UNIQUE (org_ulid),
  UNIQUE (org_key)
);

CREATE TABLE IF NOT EXISTS project (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_rowid     INTEGER NOT NULL REFERENCES org(id),
  project_ulid  TEXT NOT NULL,
  project_key   TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  UNIQUE (project_ulid),
  UNIQUE (org_rowid, project_key),
  UNIQUE (org_rowid, id)              -- 供 admin_scope 复合外键引用
);

-- 管理主体与scope（§0.6）：凭据只存 scrypt 哈希；吊销不可逆（触发器）
CREATE TABLE IF NOT EXISTS admin_subject (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  label          TEXT NOT NULL,
  token_hash     TEXT NOT NULL,
  token_salt     TEXT NOT NULL,
  created_at_ms  INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  expires_at_ms  INTEGER NOT NULL CHECK (typeof(expires_at_ms)='integer' AND expires_at_ms >= 0),
  revoked_at_ms  INTEGER CHECK (revoked_at_ms IS NULL OR typeof(revoked_at_ms)='integer'),
  UNIQUE (label)
);
CREATE INDEX IF NOT EXISTS idx_admin_subject_token ON admin_subject(token_hash);

CREATE TABLE IF NOT EXISTS admin_scope (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_rowid   INTEGER NOT NULL REFERENCES admin_subject(id),
  org_rowid     INTEGER NOT NULL REFERENCES org(id),
  project_rowid INTEGER,                          -- NULL=org级scope（继承该org全部项目，§0.6）
  granted_at_ms INTEGER NOT NULL CHECK (typeof(granted_at_ms)='integer'),
  revoked_at_ms INTEGER CHECK (revoked_at_ms IS NULL OR typeof(revoked_at_ms)='integer'),
  -- org/project 一致性：project_rowid 非空时必须属于 org_rowid（复合外键；NULL跳过即org级）
  FOREIGN KEY (org_rowid, project_rowid) REFERENCES project(org_rowid, id)
);
CREATE INDEX IF NOT EXISTS idx_admin_scope_admin ON admin_scope(admin_rowid, revoked_at_ms);

-- 本地受控CLI动作审计；admin_rowid 可空=系统初始化动作（init 引导）经明确写入口产生
CREATE TABLE IF NOT EXISTS admin_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_rowid   INTEGER REFERENCES admin_subject(id),
  action        TEXT NOT NULL,
  target_json   TEXT NOT NULL,                        -- 仅非敏感参数；禁止任何token明文
  at_ms         INTEGER NOT NULL CHECK (typeof(at_ms)='integer')
);

CREATE TABLE IF NOT EXISTS enrollment (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_ulid    TEXT NOT NULL,
  org_rowid          INTEGER NOT NULL REFERENCES org(id),
  project_rowid      INTEGER NOT NULL REFERENCES project(id),
  installation_ulid  TEXT NOT NULL,
  public_key_pem     TEXT NOT NULL,
  fingerprint_server TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked','expired')),
  requested_at_ms    INTEGER NOT NULL CHECK (typeof(requested_at_ms)='integer'),
  requested_version  TEXT,
  client_rowid        INTEGER REFERENCES client(id),
  decided_at_ms       INTEGER CHECK (decided_at_ms IS NULL OR typeof(decided_at_ms)='integer'),
  decided_by_admin    INTEGER REFERENCES admin_subject(id),
  reason              TEXT,
  UNIQUE (enrollment_ulid)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_enrollment_active
  ON enrollment(installation_ulid) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS idx_enrollment_scope_status
  ON enrollment(org_rowid, project_rowid, status, requested_at_ms);

CREATE TABLE IF NOT EXISTS client (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ulid        TEXT NOT NULL,
  enrollment_rowid    INTEGER NOT NULL REFERENCES enrollment(id),
  org_rowid          INTEGER NOT NULL REFERENCES org(id),
  project_rowid      INTEGER NOT NULL REFERENCES project(id),
  installation_ulid  TEXT NOT NULL,
  public_key_pem     TEXT NOT NULL,
  fingerprint_server TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('approved','revoked','expired')),
  last_epoch         INTEGER NOT NULL DEFAULT 0 CHECK (typeof(last_epoch)='integer' AND last_epoch >= 0),
  granted_at_ms      INTEGER NOT NULL CHECK (typeof(granted_at_ms)='integer'),
  valid_until_ms     INTEGER NOT NULL CHECK (typeof(valid_until_ms)='integer'),
  revoked_at_ms      INTEGER CHECK (revoked_at_ms IS NULL OR typeof(revoked_at_ms)='integer'),
  UNIQUE (client_ulid)
);
CREATE INDEX IF NOT EXISTS idx_client_scope ON client(org_rowid, project_rowid, status);

CREATE TABLE IF NOT EXISTS session (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  client_rowid           INTEGER NOT NULL REFERENCES client(id),
  epoch                  INTEGER NOT NULL CHECK (typeof(epoch)='integer' AND epoch >= 1),
  token_hash             TEXT NOT NULL,
  heartbeat_interval_sec INTEGER NOT NULL CHECK (typeof(heartbeat_interval_sec)='integer' AND heartbeat_interval_sec >= 1),
  created_at_ms          INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  lease_expires_at_ms    INTEGER NOT NULL CHECK (typeof(lease_expires_at_ms)='integer'),
  revoked_at_ms          INTEGER CHECK (revoked_at_ms IS NULL OR typeof(revoked_at_ms)='integer'),
  last_heartbeat_ms      INTEGER CHECK (last_heartbeat_ms IS NULL OR typeof(last_heartbeat_ms)='integer'),
  UNIQUE (client_rowid, epoch)
);
CREATE INDEX IF NOT EXISTS idx_session_token ON session(token_hash, revoked_at_ms);

CREATE TABLE IF NOT EXISTS heartbeat_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_rowid      INTEGER NOT NULL REFERENCES session(id),
  at_ms              INTEGER NOT NULL CHECK (typeof(at_ms)='integer'),
  epoch              INTEGER NOT NULL CHECK (typeof(epoch)='integer' AND epoch >= 1),
  local_ui_tasks     INTEGER NOT NULL CHECK (typeof(local_ui_tasks)='integer' AND local_ui_tasks >= 0),
  cli_tasks          INTEGER NOT NULL CHECK (typeof(cli_tasks)='integer' AND cli_tasks >= 0),
  last_event_seq_ack INTEGER CHECK (last_event_seq_ack IS NULL OR (typeof(last_event_seq_ack)='integer' AND last_event_seq_ack >= 0))
);
CREATE INDEX IF NOT EXISTS idx_heartbeat_session_time ON heartbeat_log(session_rowid, at_ms);

CREATE TABLE IF NOT EXISTS stream (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_key        TEXT NOT NULL,
  low_watermark_seq INTEGER NOT NULL DEFAULT 1 CHECK (typeof(low_watermark_seq)='integer' AND low_watermark_seq >= 1),
  next_seq          INTEGER NOT NULL DEFAULT 1 CHECK (typeof(next_seq)='integer' AND next_seq >= 1),
  created_at_ms     INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  CHECK (low_watermark_seq <= next_seq),
  UNIQUE (stream_key)
);

CREATE TABLE IF NOT EXISTS event (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_rowid    INTEGER NOT NULL REFERENCES stream(id),
  seq             INTEGER NOT NULL CHECK (typeof(seq)='integer' AND seq >= 1),
  event_ulid      TEXT NOT NULL,
  epoch           INTEGER NOT NULL CHECK (typeof(epoch)='integer' AND epoch >= 1),
  type            TEXT NOT NULL,
  data_json       TEXT NOT NULL,
  occurred_at_ms  INTEGER NOT NULL CHECK (typeof(occurred_at_ms)='integer'),
  UNIQUE (stream_rowid, seq)
);

CREATE TABLE IF NOT EXISTS event_ack (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_rowid  INTEGER NOT NULL REFERENCES stream(id),
  session_rowid INTEGER NOT NULL REFERENCES session(id),
  acked_seq     INTEGER NOT NULL CHECK (typeof(acked_seq)='integer' AND acked_seq >= 1),
  updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'),
  UNIQUE (stream_rowid)
);

CREATE TABLE IF NOT EXISTS challenge (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_key    TEXT NOT NULL,
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('installation','client')),
  purpose        TEXT NOT NULL CHECK (purpose IN ('enrollment.recover','session.create')),
  challenge_hash TEXT NOT NULL,
  created_at_ms  INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  expires_at_ms  INTEGER NOT NULL CHECK (typeof(expires_at_ms)='integer'),
  consumed_at_ms INTEGER CHECK (consumed_at_ms IS NULL OR typeof(consumed_at_ms)='integer')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_challenge_hash ON challenge(challenge_hash);
CREATE INDEX IF NOT EXISTS idx_challenge_subject ON challenge(subject_type, subject_key, purpose, consumed_at_ms);

-- ============ v0.1.2 库层不变量触发器 ============

-- I1 吊销不可逆（三处）：置位后禁止清空
CREATE TRIGGER IF NOT EXISTS trg_admin_subject_no_unrevoke BEFORE UPDATE ON admin_subject
  WHEN OLD.revoked_at_ms IS NOT NULL AND NEW.revoked_at_ms IS NULL
  BEGIN SELECT RAISE(ABORT, 'admin_subject revocation is irreversible'); END;
CREATE TRIGGER IF NOT EXISTS trg_client_no_unrevoke BEFORE UPDATE ON client
  WHEN (OLD.revoked_at_ms IS NOT NULL AND NEW.revoked_at_ms IS NULL)
    OR (OLD.revoked_at_ms IS NOT NULL AND NEW.revoked_at_ms <> OLD.revoked_at_ms)
  BEGIN SELECT RAISE(ABORT, 'client revocation is irreversible'); END;
CREATE TRIGGER IF NOT EXISTS trg_session_no_unrevoke BEFORE UPDATE ON session
  WHEN OLD.revoked_at_ms IS NOT NULL AND NEW.revoked_at_ms IS NULL
  BEGIN SELECT RAISE(ABORT, 'session revocation is irreversible'); END;

-- I2 client 状态不可逆出终态：revoked 不可改回任何其他状态
CREATE TRIGGER IF NOT EXISTS trg_client_status_term BEFORE UPDATE ON client
  WHEN OLD.status = 'revoked' AND NEW.status <> 'revoked'
  BEGIN SELECT RAISE(ABORT, 'revoked client status is terminal'); END;

-- I3 challenge 一次性消费不可逆
CREATE TRIGGER IF NOT EXISTS trg_challenge_consumed BEFORE UPDATE ON challenge
  WHEN OLD.consumed_at_ms IS NOT NULL AND NEW.consumed_at_ms IS NULL
  BEGIN SELECT RAISE(ABORT, 'challenge consumption is irreversible'); END;

-- I4 事件 seq 无洞且单调：只能按 stream.next_seq 追加
CREATE TRIGGER IF NOT EXISTS trg_event_seq_contiguous BEFORE INSERT ON event
  WHEN NEW.seq <> (SELECT next_seq FROM stream WHERE id = NEW.stream_rowid)
  BEGIN SELECT RAISE(ABORT, 'event seq must equal stream.next_seq (contiguous append only)'); END;
CREATE TRIGGER IF NOT EXISTS trg_event_seq_advance AFTER INSERT ON event
  BEGIN UPDATE stream SET next_seq = NEW.seq + 1 WHERE id = NEW.stream_rowid; END;

-- I5 session epoch 严格 +1（依赖 client.last_epoch 单调水位）；新会话签发即作废同 client 全部旧会话
CREATE TRIGGER IF NOT EXISTS trg_session_epoch_seq BEFORE INSERT ON session
  WHEN NEW.epoch <> (SELECT last_epoch FROM client WHERE id = NEW.client_rowid) + 1
  BEGIN SELECT RAISE(ABORT, 'session epoch must equal client.last_epoch + 1'); END;
CREATE TRIGGER IF NOT EXISTS trg_session_epoch_advance AFTER INSERT ON session
  BEGIN
    UPDATE client SET last_epoch = NEW.epoch WHERE id = NEW.client_rowid;
    UPDATE session SET revoked_at_ms = NEW.created_at_ms
      WHERE client_rowid = NEW.client_rowid AND epoch < NEW.epoch AND revoked_at_ms IS NULL;
  END;

-- I6 ack 游标只进不退（存max语义）
CREATE TRIGGER IF NOT EXISTS trg_ack_monotonic BEFORE UPDATE ON event_ack
  WHEN NEW.acked_seq < OLD.acked_seq
  BEGIN SELECT RAISE(ABORT, 'event ack cursor is monotonic (max-only)'); END;

-- I7 event_ack 行身份：stream 不可改；session 归属仅允许"同client、更高epoch、未作废"会话原子接管
--    （合法重连路径：旧会话持有游标 → 新会话签发 → 当前会话UPSERT接管，水面保留；旧会话不能接管/回写）
CREATE TRIGGER IF NOT EXISTS trg_ack_owner_takeover BEFORE UPDATE ON event_ack
  WHEN NEW.stream_rowid <> OLD.stream_rowid
    OR ( NEW.session_rowid <> OLD.session_rowid AND NOT EXISTS (
           SELECT 1 FROM session ns JOIN session os ON os.id = OLD.session_rowid
           WHERE ns.id = NEW.session_rowid
             AND ns.client_rowid = os.client_rowid    -- 同client
             AND ns.epoch > os.epoch                   -- 仅向前接管（旧→新）
             AND ns.revoked_at_ms IS NULL ) )          -- 接管者必须未作废
  BEGIN SELECT RAISE(ABORT, 'event_ack ownership may only move forward to a newer active session of the same client; stream reassignment forbidden'); END;

-- I8 ack 能力/存活一致性：游标行不得迁移到已作废会话或非本流属主会话（防御性，与I7配套）
CREATE TRIGGER IF NOT EXISTS trg_ack_owner_alive_check BEFORE UPDATE ON event_ack
  WHEN NEW.session_rowid <> OLD.session_rowid AND EXISTS (
        SELECT 1 FROM session s WHERE s.id = NEW.session_rowid
          AND (s.revoked_at_ms IS NOT NULL OR s.client_rowid <>
               (SELECT client_rowid FROM session WHERE id = OLD.session_rowid)) )
    AND EXISTS (SELECT 1 FROM session WHERE id = NEW.session_rowid)
  BEGIN SELECT RAISE(ABORT, 'event_ack new owner must be an active session of the stream owner client'); END;
