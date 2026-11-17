-- 0008: 个人固定scope operator凭据（W25网站受控写面——root裁定2026-11-07 01a1b448-3/用户产品模型）
-- 增量迁移：无DROP、无破坏性变更。admin_subject 增 role 列区分 admin / operator：
--   * admin（既有缺省，所有现存行自动='admin'）：全部管理面；
--   * operator（个人任务操作者）：仅任务 create/read/cancel 白名单路由（gate 在 app.mjs dispatch 层，
--     ROLE_OPERATOR_ROUTES），凭据由既有受控管理面 admincli 签发（orgKey/projectKey 固定 scope、TTL、
--     可吊销、token哈希入库同既有模式），token 不入 Issue/日志。
ALTER TABLE admin_subject ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','operator') AND typeof(role)='text');
