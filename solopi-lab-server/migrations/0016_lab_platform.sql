-- Unified execution tasks and durable IM. Existing Agent transport receipts remain separate.
CREATE TABLE lab_catalog (
 gmt_create TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 client_uid TEXT PRIMARY KEY, org_uid TEXT NOT NULL, project_uid TEXT NOT NULL,
 body_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE lab_task (
 gmt_create TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 task_uid TEXT PRIMARY KEY, org_uid TEXT NOT NULL, project_uid TEXT NOT NULL,
 client_uid TEXT NOT NULL, request_uid TEXT NOT NULL, request_sha TEXT NOT NULL,
 group_uid TEXT NOT NULL, body_json TEXT NOT NULL, status TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
 UNIQUE(org_uid,project_uid,request_uid)
) STRICT;
CREATE INDEX lab_task_scope ON lab_task(org_uid,project_uid,created_at_ms);
CREATE TABLE lab_conversation (
 gmt_create TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 conversation_uid TEXT PRIMARY KEY, org_uid TEXT NOT NULL, project_uid TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('direct','group')), title TEXT NOT NULL,
 members_json TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE lab_message (
 gmt_create TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 message_uid TEXT PRIMARY KEY, conversation_uid TEXT NOT NULL REFERENCES lab_conversation(conversation_uid),
 sender_uid TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
 request_uid TEXT NOT NULL, request_sha TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
 UNIQUE(conversation_uid,request_uid,sender_uid)
) STRICT;
CREATE INDEX lab_message_conversation ON lab_message(conversation_uid,created_at_ms,message_uid);
CREATE TABLE lab_command (
 gmt_create TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 command_uid TEXT PRIMARY KEY, org_uid TEXT NOT NULL, project_uid TEXT NOT NULL,
 client_uid TEXT NOT NULL, kind TEXT NOT NULL, body_json TEXT NOT NULL,
 request_sha TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT,
 created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX lab_command_queue ON lab_command(client_uid,status,created_at_ms);
