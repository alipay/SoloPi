-- 0004: 设备快照与每Client安装头部（v0.2.0设备合同冻结版）。
-- 增量迁移：仅新增两表，无DROP/无破坏性变更；时间列typeof强类型；离线不删行——状态列承载。
-- 行归属三rowid在INSERT时由会话解析定格，此后不可变更（重注册=新client行新清单，禁止跨client改绑）。
CREATE TABLE IF NOT EXISTS device (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_ulid TEXT NOT NULL CHECK (typeof(device_ulid)='text'),
  org_rowid INTEGER NOT NULL REFERENCES org(id),
  project_rowid INTEGER NOT NULL REFERENCES project(id),
  client_rowid INTEGER NOT NULL REFERENCES client(id),
  device_key TEXT NOT NULL CHECK (typeof(device_key)='text'),
  kind TEXT NOT NULL CHECK (kind IN ('phone','glasses','tablet','other') AND typeof(kind)='text'),
  name TEXT,
  discovery_fingerprint TEXT NOT NULL CHECK (typeof(discovery_fingerprint)='text'),
  os TEXT NOT NULL CHECK (typeof(os)='text'),
  adb_serial TEXT,
  first_seen_ms INTEGER NOT NULL CHECK (typeof(first_seen_ms)='integer'),
  last_seen_ms INTEGER CHECK (last_seen_ms IS NULL OR typeof(last_seen_ms)='integer'),
  last_snapshot_ms INTEGER NOT NULL CHECK (typeof(last_snapshot_ms)='integer'),
  last_snapshot_id TEXT NOT NULL CHECK (typeof(last_snapshot_id)='text'),
  last_snapshot_revision INTEGER NOT NULL CHECK (typeof(last_snapshot_revision)='integer' AND last_snapshot_revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('online','stale','offline') AND typeof(status)='text'),
  UNIQUE (client_rowid, device_key),
  UNIQUE (client_rowid, device_ulid)
);
CREATE INDEX IF NOT EXISTS idx_device_scope ON device(org_rowid, project_rowid, status, last_snapshot_ms);
-- 快照安装头部：每Client单一水位（epoch+seq服务端单调裁决，与时钟无关）。
-- 幂等重放、迟到丢弃、seq跳跃拒绝均以本行为唯一权威；discovery-failed只推进水位不安装清单。
CREATE TABLE IF NOT EXISTS client_snapshot_head (
  client_rowid INTEGER PRIMARY KEY REFERENCES client(id),
  epoch INTEGER NOT NULL CHECK (typeof(epoch)='integer' AND epoch >= 1),
  seq INTEGER NOT NULL CHECK (typeof(seq)='integer' AND seq >= 1),
  snapshot_id TEXT NOT NULL CHECK (typeof(snapshot_id)='text'),
  content_sha TEXT NOT NULL CHECK (typeof(content_sha)='text'),
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision >= 1),
  updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer')
);
