-- 0010: Server侧组登记投影（合同v0.4.0 §2/§3 冻结载荷的正式DDL；DG1=W25组链串行接线的第1步）
-- 增量迁移：无DROP、无破坏性变更、纯新增表/触发器/索引（server/src/group-registry.mjs内
-- ensureGroupRegistrySchema同DDL字节——候选期隔离库与正式库结构一致由本迁移保证）。
--   * group_registration：Desktop唯一正式组写者的登记投影（只读状态，(client_ulid, group_uid)身份、
--     revision单调CAS、deleted墓碑不可回填）——合同 §2；
--   * group_execution_projection：组执行投影（不可变核心=groupExecutionId/clientId/groupSnapshot/
--     requestId/taskId；原生requestId/taskId单绑定UNIQUE；前向状态机由模块层强制）——合同 §3；
--   * group_execution_projection_immutable触发器：快照/原生身份/SQL标量归属列
--     (client_ulid/group_uid/group_revision)一律不可改写——7113451"SQL归属不可变"红例闭合载荷。
-- 测试断言：迁移版本9→10；正式库应用须待部署链审批，本候选仅隔离回归实跑（不部署）。
CREATE TABLE IF NOT EXISTS group_registration (
  client_ulid TEXT NOT NULL, group_uid TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (typeof(revision)='integer' AND revision>=1),
  deleted INTEGER NOT NULL CHECK (deleted IN (0,1) AND typeof(deleted)='integer'),
  name TEXT NOT NULL, member_count INTEGER NOT NULL CHECK (typeof(member_count)='integer'),
  body TEXT NOT NULL, updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'),
  PRIMARY KEY (client_ulid, group_uid));
CREATE TABLE IF NOT EXISTS group_execution_projection (
  execution_uid TEXT PRIMARY KEY, client_ulid TEXT NOT NULL, group_uid TEXT NOT NULL,
  request_uid TEXT NOT NULL UNIQUE, task_uid TEXT NOT NULL UNIQUE,
  group_revision INTEGER NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('prepared','dispatching','unknown','done')),
  body TEXT NOT NULL, updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'));
CREATE TRIGGER IF NOT EXISTS group_execution_projection_immutable BEFORE UPDATE ON group_execution_projection
 WHEN NEW.execution_uid IS NOT OLD.execution_uid OR NEW.request_uid IS NOT OLD.request_uid OR NEW.task_uid IS NOT OLD.task_uid
  OR NEW.client_ulid IS NOT OLD.client_ulid OR NEW.group_uid IS NOT OLD.group_uid OR NEW.group_revision IS NOT OLD.group_revision
  OR json_extract(NEW.body,'$.groupExecutionId') IS NOT json_extract(OLD.body,'$.groupExecutionId')
  OR json_extract(NEW.body,'$.requestId') IS NOT json_extract(OLD.body,'$.requestId')
  OR json_extract(NEW.body,'$.taskId') IS NOT json_extract(OLD.body,'$.taskId')
  OR json_extract(NEW.body,'$.clientId') IS NOT json_extract(OLD.body,'$.clientId')
  OR json_extract(NEW.body,'$.groupSnapshot') IS NOT json_extract(OLD.body,'$.groupSnapshot')
 BEGIN SELECT RAISE(ABORT,'GROUP_PROJECTION_IMMUTABLE'); END;
CREATE INDEX IF NOT EXISTS idx_group_exec_by_client ON group_execution_projection(client_ulid, group_uid);
