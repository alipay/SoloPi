-- 0002: 对齐契约API（contracts v0.1.4 §1.4/§3）与DDL的存储缺口（增量，无破坏性）
-- 背景：契约 enrollmentRow/enrollmentDetail 需要 deviceScope/networkProfile、clientSummary 需要
-- capabilities/clientVersion，而契约 ddl.sql 未定义这些列。本迁移为服务端实现所需的最小增量列，
-- 已在issue回执登记为"契约DDL↔API缺口"，待下一契约patch统一收编；不影响任何既有列。
ALTER TABLE enrollment ADD COLUMN device_scope_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE enrollment ADD COLUMN network_profile_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE enrollment ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE client ADD COLUMN device_scope_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE client ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE client ADD COLUMN client_version TEXT;
