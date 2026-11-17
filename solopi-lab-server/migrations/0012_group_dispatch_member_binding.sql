-- 0012: 组派发账本 r3 增量（DG107 7122976 精确报告：请求时成员快照绑定列）。
-- 增量迁移：无DROP、无重命名、纯 ALTER ADD COLUMN（SQLite 逐列增量；group_dispatch 既有行
-- 的 member_sha 为 NULL，语义=0012 前历史派发未绑定成员摘要，对账按缺绑定显式拒绝而非静默放行——
-- 正式库未部署 0011，因此实际不存在 0012 前历史行，NULL 仅为隔离链完整性的防御语义）。
-- server/src/group-dispatch.mjs 内 ensureGroupDispatchSchema 的 CREATE TABLE 基线含本列
-- （fresh 库直含 member_sha；迁移链 0001…0012 与 ensure 同构，隔离回归断言）。
-- 0011 字节不变（69a4260d…），符合"唯一合同负责人给精确增量迁移"要求。
CREATE INDEX IF NOT EXISTS idx_group_dispatch_pending ON group_dispatch(client_ulid, status, created_at_ms);
ALTER TABLE group_dispatch ADD COLUMN member_sha TEXT;
-- DG108红①闭合：专用 member_sha 不可变守卫——真实0011非空库升级后，既有 group_dispatch_immutable
-- 触发器不覆盖新列且 IF NOT EXISTS 不会重定义它；篡改请求成员摘要必须被本守卫显式拒绝。
-- server/src/group-dispatch.mjs 内 ensureGroupDispatchSchema 以同DDL字节创建本触发器（两库同源）。
-- 旧行NULL的保守处置：0012前历史行的 member_sha 为 NULL，对账一律显式 GROUP_EXECUTION_CONFLICT
-- （拒绝确认），不得按最新登记补写历史摘要（历史不可回填）。
CREATE TRIGGER IF NOT EXISTS group_dispatch_member_immutable BEFORE UPDATE ON group_dispatch
 WHEN NEW.member_sha IS NOT OLD.member_sha
 BEGIN SELECT RAISE(ABORT,'GROUP_DISPATCH_IMMUTABLE'); END;
