-- 0003: 注销回执的可追溯关联——记录发起自注销的会话行id。
-- 仅新增列（增量迁移，无DROP/无破坏性）；NULL表示未被自注销流程吊销（管理员吊销或未吊销）。
ALTER TABLE client ADD COLUMN revoked_by_session INTEGER REFERENCES session(id);
