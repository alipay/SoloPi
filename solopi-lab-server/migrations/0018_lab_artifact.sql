-- Case-owned immutable recording blobs; paths are generated exclusively by Server.
CREATE TABLE lab_artifact (
 artifact_uid TEXT PRIMARY KEY, task_uid TEXT NOT NULL REFERENCES lab_task(task_uid),
 case_uid TEXT NOT NULL, role TEXT NOT NULL, content_sha TEXT NOT NULL,
 size_bytes INTEGER NOT NULL, mime_type TEXT NOT NULL, state TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL, gmt_create TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX lab_artifact_task ON lab_artifact(task_uid,case_uid);
