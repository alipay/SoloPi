-- 0005: 媒体独立数据面增量（v0.2.0媒体r3实施面）。
-- 增量迁移：仅新增两表，无DROP/无破坏性变更；时间列typeof强类型；行终态保留不删。
-- 控制API只做授权/状态/停止（不承载逐路码流）；码流走独立media-view数据面进程，原始H264字节透传、不转码、不落盘。
CREATE TABLE IF NOT EXISTS media_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_session_ulid TEXT NOT NULL CHECK (typeof(media_session_ulid)='text'),
  org_rowid INTEGER NOT NULL REFERENCES org(id),
  project_rowid INTEGER NOT NULL REFERENCES project(id),
  client_rowid INTEGER NOT NULL REFERENCES client(id),
  device_rowid INTEGER NOT NULL REFERENCES device(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('screen-preview') AND typeof(purpose)='text'),
  status TEXT NOT NULL CHECK (status IN ('authorized','live','stopped','failed','expired') AND typeof(status)='text'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  expires_at_ms INTEGER NOT NULL CHECK (typeof(expires_at_ms)='integer'),
  stops_at_ms INTEGER CHECK (stops_at_ms IS NULL OR typeof(stops_at_ms)='integer'),
  client_joined_ms INTEGER CHECK (client_joined_ms IS NULL OR typeof(client_joined_ms)='integer'),
  viewer_joined_ms INTEGER CHECK (viewer_joined_ms IS NULL OR typeof(viewer_joined_ms)='integer'),
  ended_reason TEXT CHECK (ended_reason IS NULL OR typeof(ended_reason)='text'),
  ended_at_ms INTEGER CHECK (ended_at_ms IS NULL OR typeof(ended_at_ms)='integer')
);
CREATE INDEX IF NOT EXISTS idx_media_session_scope ON media_session(org_rowid, project_rowid, status, created_at_ms);
-- 短时单用途票据：一票一角色（viewer|client），绑定媒体会话；consume一次性原子UPDATE，创建后只可由获取方在TTL内使用一次。
CREATE TABLE IF NOT EXISTS media_ticket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_ulid TEXT NOT NULL CHECK (typeof(ticket_ulid)='text'),
  media_session_rowid INTEGER NOT NULL REFERENCES media_session(id),
  role TEXT NOT NULL CHECK (role IN ('viewer','client') AND typeof(role)='text'),
  token_hash TEXT NOT NULL CHECK (typeof(token_hash)='text'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  expires_at_ms INTEGER NOT NULL CHECK (typeof(expires_at_ms)='integer'),
  consumed_at_ms INTEGER CHECK (consumed_at_ms IS NULL OR typeof(consumed_at_ms)='integer'),
  revoked_at_ms INTEGER CHECK (revoked_at_ms IS NULL OR typeof(revoked_at_ms)='integer')
);
