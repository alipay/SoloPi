-- 0013: 组执行授权账本（DG120接线批次：由唯一合同负责人将已审候选DDL精确纳迁移链，与group-grant.mjs ensure同构；
-- 结构语义见组合同草案§P1—P5。增量迁移：无DROP、纯新增表/触发器/索引；版本断言12→13随接线自然演进）。
-- 增量迁移：无DROP、纯新增表/触发器/索引；server/src/group-grant.mjs 内 ensureGroupGrantSchema
-- 同DDL字节（隔离回归断言）。

-- 不可变语义：approver/target/group/revision/member/payload_sha/payload_bytes/plan_sha/step_profile/
-- grant_wire 全不可变；expires_at_ms 只可缩短不可延长（失效收紧方向）；吊销/消费为唯一可变路径。
CREATE TABLE IF NOT EXISTS group_execution_grant (
  grant_uid TEXT PRIMARY KEY, approver_rowid INTEGER NOT NULL CHECK (typeof(approver_rowid)='integer'),
  approver_label TEXT NOT NULL, target_client_ulid TEXT NOT NULL,
  group_uid TEXT NOT NULL, expected_revision INTEGER NOT NULL CHECK (typeof(expected_revision)='integer' AND expected_revision>=1),
  member_sha TEXT NOT NULL, payload_sha TEXT NOT NULL, payload_bytes INTEGER NOT NULL CHECK (typeof(payload_bytes)='integer' AND payload_bytes>=0),
  plan_sha TEXT NOT NULL, step_profile TEXT NOT NULL CHECK (step_profile='bound-payload'),
  grant_wire TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL CHECK (typeof(issued_at_ms)='integer'),
  expires_at_ms INTEGER NOT NULL CHECK (typeof(expires_at_ms)='integer'),
  revoked_at_ms INTEGER, revoked_by_rowid INTEGER,
  consumed_request_uid TEXT UNIQUE,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms)='integer'),
  updated_at_ms INTEGER NOT NULL CHECK (typeof(updated_at_ms)='integer'));
CREATE TRIGGER IF NOT EXISTS group_execution_grant_immutable BEFORE UPDATE ON group_execution_grant
 WHEN NEW.grant_uid IS NOT OLD.grant_uid OR NEW.approver_rowid IS NOT OLD.approver_rowid
  OR NEW.target_client_ulid IS NOT OLD.target_client_ulid OR NEW.group_uid IS NOT OLD.group_uid
  OR NEW.expected_revision IS NOT OLD.expected_revision OR NEW.member_sha IS NOT OLD.member_sha
  OR NEW.payload_sha IS NOT OLD.payload_sha OR NEW.payload_bytes IS NOT OLD.payload_bytes
  OR NEW.plan_sha IS NOT OLD.plan_sha OR NEW.step_profile IS NOT OLD.step_profile
  OR NEW.grant_wire IS NOT OLD.grant_wire OR NEW.expires_at_ms > OLD.expires_at_ms
 BEGIN SELECT RAISE(ABORT,'GROUP_GRANT_IMMUTABLE'); END;
CREATE INDEX IF NOT EXISTS idx_geg_by_target ON group_execution_grant(target_client_ulid, group_uid);
CREATE INDEX IF NOT EXISTS idx_geg_binding ON group_execution_grant(target_client_ulid, payload_sha, expires_at_ms);
