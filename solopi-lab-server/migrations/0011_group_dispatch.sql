-- 0011: Server侧组派发请求账本（合同候选：v0.4.1-draft/group-dispatch-contract-draft.md；DG1=组链串行接线第3步前置）
-- 增量迁移：无DROP、无破坏性变更、纯新增表/触发器/索引（server/src/group-dispatch.mjs内
-- ensureGroupDispatchSchema同DDL字节——候选期隔离库与正式库结构一致由本迁移保证）。
--   * group_dispatch：Server侧派发请求账本（不可变核心=dispatch_uid/client_ulid/group_uid/
--     request_uid/group_revision/plan_sha/payload_sha/payload_bytes/dispatch_wire；request_uid
--     单绑定UNIQUE即请求幂等键；cancel_requested_at只首写、终态不擦除——与冻结执行投影的
--     stopRequestedAt事实语义同口径；迟结果(late_result)只记账不改写事实）。
--   * group_dispatch_immutable触发器：派发不可变核心一律不可改写（对账事实可审计）。
-- 注意：本表是Server侧请求/对账账本，不改变"Desktop为组执行唯一正式写者"权威边界（合同§0）；
-- 派发确认绑定=冻结group_execution_projection的prepared投影行（native准备身份），本表不重复裁决。
-- 测试断言：迁移版本10→11；正式库应用须待部署链审批，本候选仅隔离回归实跑（不部署）。
CREATE TABLE IF NOT EXISTS group_dispatch (
  dispatch_uid TEXT PRIMARY KEY,
  client_ulid TEXT NOT NULL,
  group_uid TEXT NOT NULL,
  request_uid TEXT NOT NULL UNIQUE,
  group_revision INTEGER NOT NULL CHECK (typeof(group_revision)='integer' AND group_revision>=1),
  plan_sha TEXT NOT NULL,
  payload_sha TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (typeof(payload_bytes)='integer' AND payload_bytes>=0),
  status TEXT NOT NULL CHECK (status IN ('requested','confirmed','dispatching','unknown','done','cancelled')),
  cancel_requested_at TEXT,
  task_uid TEXT,
  confirmed_at TEXT,
  terminal_at TEXT,
  terminal_outcome TEXT,
  late_result TEXT,
  dispatch_wire TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'));
CREATE TRIGGER IF NOT EXISTS group_dispatch_immutable BEFORE UPDATE ON group_dispatch
 WHEN NEW.dispatch_uid IS NOT OLD.dispatch_uid OR NEW.client_ulid IS NOT OLD.client_ulid
  OR NEW.group_uid IS NOT OLD.group_uid OR NEW.request_uid IS NOT OLD.request_uid
  OR NEW.group_revision IS NOT OLD.group_revision OR NEW.plan_sha IS NOT OLD.plan_sha
  OR NEW.payload_sha IS NOT OLD.payload_sha OR NEW.payload_bytes IS NOT OLD.payload_bytes
  OR json_extract(NEW.dispatch_wire,'$.groupId') IS NOT json_extract(OLD.dispatch_wire,'$.groupId')
  OR json_extract(NEW.dispatch_wire,'$.requestId') IS NOT json_extract(OLD.dispatch_wire,'$.requestId')
  OR json_extract(NEW.dispatch_wire,'$.payload') IS NOT json_extract(OLD.dispatch_wire,'$.payload')
 BEGIN SELECT RAISE(ABORT,'GROUP_DISPATCH_IMMUTABLE'); END;
CREATE INDEX IF NOT EXISTS idx_group_dispatch_by_client ON group_dispatch(client_ulid, group_uid);
