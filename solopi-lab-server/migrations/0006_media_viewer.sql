-- 0006: 媒体观看主体增量（B7：/mv查看须绑定受信观看主体；状态/停止校验创建者或明确授权角色）
-- 增量迁移：仅加一列，无DROP/无破坏性变更；viewer_subject_ref为部署层数字主体hash（无PII、不可枚举），
-- 由httpview在观看主体会话建立并cookie鉴权后经内部头注入；缺失该头时仅admin权威可操作（明确授权角色）。
ALTER TABLE media_session ADD COLUMN viewer_subject_ref TEXT NULL CHECK (viewer_subject_ref IS NULL OR (typeof(viewer_subject_ref)='text' AND length(viewer_subject_ref) >= 43 AND length(viewer_subject_ref) <= 64));
