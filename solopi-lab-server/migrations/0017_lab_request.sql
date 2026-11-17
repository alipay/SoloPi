-- Superagent orchestration requests refer to the same atomic execution tasks.
CREATE TABLE lab_request (
 request_uid TEXT PRIMARY KEY,
 org_uid TEXT NOT NULL, project_uid TEXT NOT NULL,
 request_sha TEXT NOT NULL, body_json TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
 gmt_create TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX lab_request_scope ON lab_request(org_uid,project_uid,created_at_ms);
