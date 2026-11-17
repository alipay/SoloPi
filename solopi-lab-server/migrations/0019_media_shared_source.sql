-- Each viewer retains its own authorization/subject/stop state; only the source owns capture.
CREATE UNIQUE INDEX idx_media_session_ulid_unique ON media_session(media_session_ulid);
ALTER TABLE media_session ADD COLUMN source_session_ulid TEXT REFERENCES media_session(media_session_ulid);
CREATE INDEX idx_media_session_source ON media_session(source_session_ulid, status, expires_at_ms);
