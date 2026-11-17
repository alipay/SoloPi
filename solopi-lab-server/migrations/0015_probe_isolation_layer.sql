-- 0015: 用户可见测试资产隔离层（DG147；处理用户现场"首页102台电脑"探针污染，根Issue用户评论授权）。
-- 增量迁移：无DROP、无破坏性变更、不修改任何既有表/触发器/合同字节。
--   * client_probe_isolation：隔离事实表（client_ulid PK + origin manifest + 归属审计主体 + 时间）。
--     核心行（client/enrollment/session 等）保持原样，不动I2终态与现有审计链；
--     RO部署层（httpview用户网站面）按本表排除被隔离client及其关联资产。
--   * 隔离**可逆**：probe-isolate/unisolate逐行INSERT/DELETE；DELETE前由
--     client_probe_isolation_audit BEFORE DELETE触发器写入admin_audit留痕，静默抹除被拒。
--   * fail-open：若本表/触发器异常不可用，RO面回落"全量可见"（污染回显但不冒充隐藏真实资产）。
CREATE TABLE IF NOT EXISTS client_probe_isolation (
  client_ulid TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  manifest_file TEXT NOT NULL DEFAULT '',
  admin_rowid INTEGER NOT NULL,
  isolated_at_ms INTEGER NOT NULL CHECK (typeof(isolated_at_ms)='integer'));
CREATE TRIGGER IF NOT EXISTS client_probe_isolation_audit BEFORE DELETE ON client_probe_isolation
 BEGIN
  INSERT INTO admin_audit(admin_rowid, action, target_json, at_ms)
  VALUES (OLD.admin_rowid, 'client.probe-unisolate', JSON_OBJECT('clientId', OLD.client_ulid, 'wasIsolatedAtMs', OLD.isolated_at_ms), CAST(strftime('%s','now') AS INTEGER)*1000);
 END;
