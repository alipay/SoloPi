-- 0007: Agent任务面（v0.3.0——Super-agent与Client agent双向第一批实施面）。
-- 增量迁移：仅新增一表，无DROP/无破坏性变更；时间列typeof强类型；终态行保留不删。
-- 上游核验（dsh-superagent main 8c32a9dc, 2026-10-31, MIT）：无远程Client-agent桥/远程工具调用协议
-- ——Executor为本地DSH session+目录、Channel=Feishu/GitHub；此处为最小自建，仅薄适配其领域语义：
-- 任务状态独立于Client执行器状态（不随Client会话生死伪造）；结果=结构化终态而非自由文本；断线不重放。
CREATE TABLE IF NOT EXISTS agent_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_task_ulid TEXT NOT NULL CHECK (typeof(agent_task_ulid)='text'),
  org_rowid INTEGER NOT NULL REFERENCES org(id),
  project_rowid INTEGER NOT NULL REFERENCES project(id),
  client_rowid INTEGER NOT NULL REFERENCES client(id),
  task_kind TEXT NOT NULL CHECK (task_kind IN ('tool-call','prompt') AND typeof(task_kind)='text'),
  tool_name TEXT CHECK (tool_name IS NULL OR (typeof(tool_name)='text' AND length(tool_name) <= 128)),
  tool_args_json TEXT CHECK (tool_args_json IS NULL OR typeof(tool_args_json)='text'),
  prompt_json TEXT CHECK (prompt_json IS NULL OR typeof(prompt_json)='text'),
  idempotency_key TEXT NOT NULL CHECK (typeof(idempotency_key)='text'),
  payload_sha TEXT NOT NULL CHECK (typeof(payload_sha)='text'),
  status TEXT NOT NULL CHECK (status IN ('queued','delivered','running','succeeded','failed','cancelled','expired') AND typeof(status)='text'),
  progress TEXT CHECK (progress IS NULL OR typeof(progress)='text'),
  timeout_sec INTEGER NOT NULL CHECK (typeof(timeout_sec)='integer'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  expires_at_ms INTEGER NOT NULL CHECK (typeof(expires_at_ms)='integer'),
  delivered_at_ms INTEGER CHECK (delivered_at_ms IS NULL OR typeof(delivered_at_ms)='integer'),
  started_at_ms INTEGER CHECK (started_at_ms IS NULL OR typeof(started_at_ms)='integer'),
  cancel_requested_ms INTEGER CHECK (cancel_requested_ms IS NULL OR typeof(cancel_requested_ms)='integer'),
  ended_at_ms INTEGER CHECK (ended_at_ms IS NULL OR typeof(ended_at_ms)='integer'),
  result_json TEXT CHECK (result_json IS NULL OR typeof(result_json)='text'),
  error TEXT CHECK (error IS NULL OR typeof(error)='text'),
  UNIQUE (client_rowid, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_agent_task_scope ON agent_task(org_rowid, project_rowid, status, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_agent_task_queue ON agent_task(client_rowid, status, id);
