#!/usr/bin/env python3
"""面向 SoloPi 验证工作节点的持久化单机控制面。"""

from __future__ import annotations

import copy
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence
from urllib.parse import parse_qs, urlsplit


SCHEMA_VERSION = 1
PLAN_SCHEMA = "solopi.ai.verification-plan/v1"
REPORT_SCHEMA = "solopi.ai.managed-report/v1"
DEVICE_SCHEMA = "solopi.ai.managed-device/v1"
TASK_SCHEMA = "solopi.ai.managed-task/v1"
ASSIGNMENT_SCHEMA = "solopi.ai.managed-assignment/v1"

ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}")
OWNER_PATTERN = re.compile(r"[A-Za-z0-9._~-]{16,256}")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
SENSITIVE_TOKEN_PATTERN = re.compile(r"verification-[0-9a-f]{32}")
BEARER_PATTERN = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/-]+=*")

DEVICE_HEALTH = frozenset({"healthy", "degraded", "offline", "quarantined"})
TASK_TERMINAL = frozenset({"passed", "failed", "not_tested", "cancelled"})
SHARD_TERMINAL = TASK_TERMINAL
ATTEMPT_ACTIVE = frozenset({"leased", "running"})
ATTEMPT_TERMINAL = frozenset(
    {"passed", "failed", "not_tested", "cancelled", "expired", "retryable_failed"}
)
RESULT_STATUSES = frozenset({"passed", "failed", "not_tested"})
SENSITIVE_KEYS = frozenset(
    {
        "ownertoken",
        "ownertokenhash",
        "authorization",
        "cookie",
        "password",
        "apikey",
        "apisecret",
        "clientsecret",
    }
)
SELECTOR_FIELDS = frozenset(
    {
        "deviceIds",
        "serials",
        "platform",
        "minApiLevel",
        "maxApiLevel",
        "capabilities",
        "labels",
    }
)

DEFAULT_LEASE_DURATION_MS = 60000
MIN_LEASE_DURATION_MS = 1000
MAX_LEASE_DURATION_MS = 1800000
DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
MAX_MATRIX_SHARDS = 64
MAX_RETRIES = 10
CIRCUIT_FAILURE_THRESHOLD = 3
CIRCUIT_OPEN_MS = 60000
RETRY_BACKOFF_BASE_MS = 1000
RETRY_BACKOFF_MAX_MS = 60000
MAX_HTTP_BODY_BYTES = 1024 * 1024


class ManagedExecutionError(ValueError):
    """类型化的控制面契约或所有权错误。"""

    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def sanitize(value: Any, known_secrets: Sequence[str] = ()) -> Any:
    if isinstance(value, dict):
        return {
            key: sanitize(item, known_secrets)
            for key, item in value.items()
            if str(key).replace("_", "").lower() not in SENSITIVE_KEYS
        }
    if isinstance(value, list):
        return [sanitize(item, known_secrets) for item in value]
    if isinstance(value, tuple):
        return [sanitize(item, known_secrets) for item in value]
    if isinstance(value, str):
        result = SENSITIVE_TOKEN_PATTERN.sub("[redacted]", value)
        result = BEARER_PATTERN.sub("Bearer [redacted]", result)
        for secret in known_secrets:
            if secret:
                result = result.replace(secret, "[redacted]")
        return result
    return value


def _now_ms(value: Optional[int]) -> int:
    if value is None:
        return int(time.time() * 1000)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ManagedExecutionError("invalid_time", "now_ms 必须是非负整数")
    return value


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or ID_PATTERN.fullmatch(value.strip()) is None:
        raise ManagedExecutionError("invalid_id", "%s 格式无效" % label)
    return value.strip()


def _owner_token(value: Optional[str]) -> str:
    candidate = value or secrets.token_urlsafe(32)
    if OWNER_PATTERN.fullmatch(candidate) is None:
        raise ManagedExecutionError(
            "invalid_owner_token",
            "所有者令牌必须包含 16 到 256 个 URL 安全字符",
        )
    return candidate


def _owner_hash(task_id: str, token: str) -> str:
    return hashlib.sha256((task_id + "\0" + token).encode("utf-8")).hexdigest()


def _json_object(value: Any, label: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ManagedExecutionError("invalid_contract", "%s 必须是对象" % label)
    return copy.deepcopy(value)


def _json_list(value: Any, label: str, allow_empty: bool = False) -> List[Any]:
    if not isinstance(value, list) or (not allow_empty and not value):
        raise ManagedExecutionError(
            "invalid_contract",
            "%s 必须是%s" % (label, "列表" if allow_empty else "非空列表"),
        )
    return copy.deepcopy(value)


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ManagedExecutionError(
            "invalid_contract",
            "%s 必须在 %d 到 %d 之间" % (label, minimum, maximum),
        )
    return value


def normalize_matrix(value: Any) -> List[Dict[str, Any]]:
    targets = _json_list(value, "device matrix")
    expanded: List[Dict[str, Any]] = []
    seen = set()
    for target_index, raw in enumerate(targets):
        target = _json_object(raw, "device matrix target")
        unknown = sorted(set(target) - {"id", "replicas", "selector"})
        if unknown:
            raise ManagedExecutionError(
                "invalid_matrix", "设备矩阵目标包含未知字段", fields=unknown
            )
        target_id = _identifier(target.get("id"), "matrix target id")
        if target_id in seen:
            raise ManagedExecutionError("duplicate_id", "设备矩阵目标 ID 重复", id=target_id)
        seen.add(target_id)
        replicas = _integer(target.get("replicas", 1), "matrix replicas", 1, MAX_MATRIX_SHARDS)
        selector = _json_object(target.get("selector", {}), "device selector")
        selector_unknown = sorted(set(selector) - SELECTOR_FIELDS)
        if selector_unknown:
            raise ManagedExecutionError(
                "invalid_selector", "设备选择器包含未知字段", fields=selector_unknown
            )
        for field in ("deviceIds", "serials", "capabilities"):
            if field in selector:
                values = _json_list(selector[field], "selector.%s" % field)
                selector[field] = [_identifier(item, "selector %s value" % field) for item in values]
        if "platform" in selector:
            selector["platform"] = _identifier(selector["platform"], "selector platform").lower()
        for field in ("minApiLevel", "maxApiLevel"):
            if field in selector:
                selector[field] = _integer(selector[field], "selector.%s" % field, 1, 1000)
        if (
            "minApiLevel" in selector
            and "maxApiLevel" in selector
            and selector["minApiLevel"] > selector["maxApiLevel"]
        ):
            raise ManagedExecutionError("invalid_selector", "设备 API 范围上下限颠倒")
        if "labels" in selector:
            labels = _json_object(selector["labels"], "selector.labels")
            selector["labels"] = {
                _identifier(key, "selector label key"): _identifier(item, "selector label value")
                for key, item in labels.items()
            }
        for replica_index in range(replicas):
            expanded.append(
                {
                    "targetId": target_id,
                    "targetIndex": target_index,
                    "replicaIndex": replica_index,
                    "selector": selector,
                }
            )
    if len(expanded) > MAX_MATRIX_SHARDS:
        raise ManagedExecutionError(
            "invalid_matrix", "展开后的设备矩阵超过分片上限",
            maximum=MAX_MATRIX_SHARDS, actual=len(expanded)
        )
    return expanded


def _device_matches(device: Mapping[str, Any], selector: Mapping[str, Any]) -> bool:
    if selector.get("deviceIds") and device["device_id"] not in selector["deviceIds"]:
        return False
    if selector.get("serials") and device["serial"] not in selector["serials"]:
        return False
    if selector.get("platform") and device["platform"] != selector["platform"]:
        return False
    if selector.get("minApiLevel") and device["api_level"] < selector["minApiLevel"]:
        return False
    if selector.get("maxApiLevel") and device["api_level"] > selector["maxApiLevel"]:
        return False
    capabilities = set(json.loads(device["capabilities_json"]))
    if not set(selector.get("capabilities", [])).issubset(capabilities):
        return False
    labels = json.loads(device["labels_json"])
    return all(labels.get(key) == item for key, item in selector.get("labels", {}).items())


class ManagedExecutionStore:
    def __init__(self, database: Path | str) -> None:
        self.database = Path(database).expanduser().resolve()
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            str(self.database), timeout=10, isolation_level=None, check_same_thread=False
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.execute("COMMIT")
        except Exception:
            try:
                connection.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        connection = self._connect()
        try:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS devices (
                    device_id TEXT PRIMARY KEY,
                    serial TEXT NOT NULL UNIQUE,
                    platform TEXT NOT NULL,
                    api_level INTEGER NOT NULL,
                    capabilities_json TEXT NOT NULL,
                    labels_json TEXT NOT NULL,
                    health TEXT NOT NULL,
                    last_seen_ms INTEGER NOT NULL,
                    generation INTEGER NOT NULL DEFAULT 0,
                    lease_id TEXT,
                    lease_task_id TEXT,
                    lease_shard_id TEXT,
                    lease_expires_ms INTEGER,
                    consecutive_failures INTEGER NOT NULL DEFAULT 0,
                    circuit_open_until_ms INTEGER NOT NULL DEFAULT 0,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    request_fingerprint TEXT NOT NULL,
                    owner_hash TEXT NOT NULL,
                    plan_json TEXT NOT NULL,
                    decisions_json TEXT NOT NULL,
                    plan_fingerprint TEXT NOT NULL,
                    max_retries INTEGER NOT NULL,
                    lease_duration_ms INTEGER NOT NULL,
                    retention_ms INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL,
                    finished_at_ms INTEGER
                );
                CREATE TABLE IF NOT EXISTS shards (
                    shard_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES tasks(task_id),
                    target_id TEXT NOT NULL,
                    target_index INTEGER NOT NULL,
                    replica_index INTEGER NOT NULL,
                    selector_json TEXT NOT NULL,
                    status TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    current_attempt_id TEXT,
                    assigned_device_id TEXT,
                    owner_generation INTEGER,
                    lease_id TEXT,
                    lease_expires_ms INTEGER,
                    next_attempt_ms INTEGER NOT NULL DEFAULT 0,
                    result_status TEXT,
                    failure_category TEXT,
                    created_at_ms INTEGER NOT NULL,
                    updated_at_ms INTEGER NOT NULL,
                    finished_at_ms INTEGER,
                    UNIQUE(task_id, target_index, replica_index)
                );
                CREATE TABLE IF NOT EXISTS attempts (
                    attempt_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES tasks(task_id),
                    shard_id TEXT NOT NULL REFERENCES shards(shard_id),
                    attempt_number INTEGER NOT NULL,
                    worker_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    serial TEXT NOT NULL,
                    lease_id TEXT NOT NULL UNIQUE,
                    owner_generation INTEGER NOT NULL,
                    lease_expires_ms INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    failure_category TEXT,
                    report_path TEXT,
                    report_json TEXT,
                    verification_outcome_fingerprint TEXT,
                    evidence_digest TEXT,
                    evidence_purged_at_ms INTEGER,
                    created_at_ms INTEGER NOT NULL,
                    started_at_ms INTEGER,
                    finished_at_ms INTEGER,
                    UNIQUE(shard_id, attempt_number)
                );
                CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL REFERENCES tasks(task_id),
                    task_sequence INTEGER NOT NULL,
                    shard_id TEXT,
                    attempt_id TEXT,
                    event_type TEXT NOT NULL,
                    timestamp_ms INTEGER NOT NULL,
                    content_json TEXT NOT NULL,
                    UNIQUE(task_id, task_sequence)
                );
                CREATE INDEX IF NOT EXISTS shards_schedulable
                    ON shards(status, next_attempt_ms, task_id, target_index, replica_index);
                CREATE INDEX IF NOT EXISTS attempts_active
                    ON attempts(status, lease_expires_ms);
                CREATE INDEX IF NOT EXISTS events_task_sequence
                    ON events(task_id, task_sequence);
                CREATE TRIGGER IF NOT EXISTS tasks_terminal_immutable
                BEFORE UPDATE OF status ON tasks
                WHEN OLD.status IN ('passed','failed','not_tested','cancelled')
                     AND NEW.status <> OLD.status
                BEGIN
                    SELECT RAISE(ABORT, 'terminal task state is immutable');
                END;
                CREATE TRIGGER IF NOT EXISTS shards_terminal_immutable
                BEFORE UPDATE OF status ON shards
                WHEN OLD.status IN ('passed','failed','not_tested','cancelled')
                     AND NEW.status <> OLD.status
                BEGIN
                    SELECT RAISE(ABORT, 'terminal shard state is immutable');
                END;
                """
            )
            row = connection.execute(
                "SELECT value FROM metadata WHERE key = 'schema_version'"
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO metadata(key, value) VALUES('schema_version', ?)",
                    (str(SCHEMA_VERSION),),
                )
            elif int(row["value"]) != SCHEMA_VERSION:
                raise ManagedExecutionError(
                    "unsupported_schema", "不支持该托管执行数据库结构"
                )
        finally:
            connection.close()

    def _append_event(
        self,
        connection: sqlite3.Connection,
        task_id: str,
        event_type: str,
        timestamp_ms: int,
        content: Mapping[str, Any],
        shard_id: Optional[str] = None,
        attempt_id: Optional[str] = None,
        known_secrets: Sequence[str] = (),
    ) -> None:
        row = connection.execute(
            "SELECT COALESCE(MAX(task_sequence), 0) + 1 AS value FROM events WHERE task_id = ?",
            (task_id,),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO events(
                task_id, task_sequence, shard_id, attempt_id,
                event_type, timestamp_ms, content_json
            ) VALUES(?,?,?,?,?,?,?)
            """,
            (
                task_id,
                row["value"],
                shard_id,
                attempt_id,
                _identifier(event_type, "event type"),
                timestamp_ms,
                canonical_json(sanitize(dict(content), known_secrets)),
            ),
        )

    def register_device(
        self,
        device_id: str,
        serial: str,
        platform: str,
        api_level: int,
        capabilities: Sequence[str],
        labels: Mapping[str, str],
        health: str = "healthy",
        now_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        timestamp = _now_ms(now_ms)
        normalized_id = _identifier(device_id, "device id")
        normalized_serial = _identifier(serial, "ADB 序列号")
        normalized_platform = _identifier(platform, "device platform").lower()
        normalized_api = _integer(api_level, "device API level", 1, 1000)
        if health not in DEVICE_HEALTH:
            raise ManagedExecutionError("invalid_health", "不支持该设备健康状态", health=health)
        if not isinstance(capabilities, (list, tuple)):
            raise ManagedExecutionError("invalid_contract", "设备能力必须是列表")
        normalized_capabilities = sorted(
            {_identifier(item, "device capability") for item in capabilities}
        )
        if not isinstance(labels, dict):
            raise ManagedExecutionError("invalid_contract", "设备标签必须是对象")
        normalized_labels = {
            _identifier(key, "device label key"): _identifier(value, "device label value")
            for key, value in labels.items()
        }
        with self._transaction() as connection:
            serial_owner = connection.execute(
                "SELECT device_id FROM devices WHERE serial = ?", (normalized_serial,)
            ).fetchone()
            if serial_owner is not None and serial_owner["device_id"] != normalized_id:
                raise ManagedExecutionError(
                    "serial_conflict", "ADB 序列号已注册",
                    deviceId=serial_owner["device_id"]
                )
            existing = connection.execute(
                "SELECT lease_id FROM devices WHERE device_id = ?", (normalized_id,)
            ).fetchone()
            if existing is None:
                connection.execute(
                    """
                    INSERT INTO devices(
                        device_id, serial, platform, api_level, capabilities_json,
                        labels_json, health, last_seen_ms, created_at_ms, updated_at_ms
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        normalized_id,
                        normalized_serial,
                        normalized_platform,
                        normalized_api,
                        canonical_json(normalized_capabilities),
                        canonical_json(normalized_labels),
                        health,
                        timestamp,
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                connection.execute(
                    """
                    UPDATE devices SET serial=?, platform=?, api_level=?, capabilities_json=?,
                        labels_json=?, health=?, last_seen_ms=?, updated_at_ms=?
                    WHERE device_id=?
                    """,
                    (
                        normalized_serial,
                        normalized_platform,
                        normalized_api,
                        canonical_json(normalized_capabilities),
                        canonical_json(normalized_labels),
                        health,
                        timestamp,
                        timestamp,
                        normalized_id,
                    ),
                )
        return self.get_device(normalized_id)

    def get_device(self, device_id: str) -> Dict[str, Any]:
        normalized = _identifier(device_id, "device id")
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT * FROM devices WHERE device_id = ?", (normalized,)
            ).fetchone()
            if row is None:
                raise ManagedExecutionError("device_not_found", "未找到托管设备")
            return self._device_payload(row)
        finally:
            connection.close()

    def list_devices(self) -> List[Dict[str, Any]]:
        connection = self._connect()
        try:
            return [
                self._device_payload(row)
                for row in connection.execute("SELECT * FROM devices ORDER BY device_id")
            ]
        finally:
            connection.close()

    @staticmethod
    def _device_payload(row: Mapping[str, Any]) -> Dict[str, Any]:
        return {
            "schemaVersion": DEVICE_SCHEMA,
            "deviceId": row["device_id"],
            "serial": row["serial"],
            "platform": row["platform"],
            "apiLevel": row["api_level"],
            "capabilities": json.loads(row["capabilities_json"]),
            "labels": json.loads(row["labels_json"]),
            "health": row["health"],
            "lastSeenAt": row["last_seen_ms"],
            "ownerGeneration": row["generation"],
            "leased": row["lease_id"] is not None,
            "leaseExpiresAt": row["lease_expires_ms"],
            "consecutiveFailures": row["consecutive_failures"],
            "circuitOpenUntil": row["circuit_open_until_ms"],
        }

    def submit_task(
        self,
        plan: Any,
        matrix: Any,
        idempotency_key: str,
        owner_token: Optional[str] = None,
        decisions: Optional[Mapping[str, Any]] = None,
        max_retries: int = 1,
        lease_duration_ms: int = DEFAULT_LEASE_DURATION_MS,
        retention_ms: int = DEFAULT_RETENTION_MS,
        now_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        timestamp = _now_ms(now_ms)
        normalized_plan = _json_object(plan, "verification plan")
        if normalized_plan.get("schemaVersion") != PLAN_SCHEMA:
            raise ManagedExecutionError("invalid_plan", "托管任务需要验证计划")
        plan_fingerprint = normalized_plan.get("planFingerprint")
        if not isinstance(plan_fingerprint, str) or SHA256_PATTERN.fullmatch(plan_fingerprint) is None:
            raise ManagedExecutionError("invalid_plan", "验证计划指纹无效")
        normalized_decisions = _json_object(decisions or {}, "Agent 决策")
        normalized_matrix = normalize_matrix(matrix)
        normalized_key = _identifier(idempotency_key, "idempotency key")
        normalized_retries = _integer(max_retries, "max retries", 0, MAX_RETRIES)
        normalized_lease = _integer(
            lease_duration_ms,
            "lease duration",
            MIN_LEASE_DURATION_MS,
            MAX_LEASE_DURATION_MS,
        )
        normalized_retention = _integer(
            retention_ms, "retention duration", 0, 365 * 24 * 60 * 60 * 1000
        )
        request = {
            "plan": normalized_plan,
            "matrix": normalized_matrix,
            "decisions": normalized_decisions,
            "maxRetries": normalized_retries,
            "leaseDurationMs": normalized_lease,
            "retentionMs": normalized_retention,
        }
        request_fingerprint = fingerprint(request)
        token = _owner_token(owner_token)
        with self._transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM tasks WHERE idempotency_key = ?", (normalized_key,)
            ).fetchone()
            if existing is not None:
                if existing["request_fingerprint"] != request_fingerprint:
                    raise ManagedExecutionError(
                        "idempotency_conflict",
                        "幂等键已用于其他任务内容",
                        taskId=existing["task_id"],
                    )
                if not hmac.compare_digest(existing["owner_hash"], _owner_hash(existing["task_id"], token)):
                    raise ManagedExecutionError(
                        "owner_mismatch", "任务幂等回执属于其他所有者"
                    )
                return self._task_payload(existing, idempotent=True)

            task_id = "task-%s" % uuid.uuid4().hex
            owner_hash = _owner_hash(task_id, token)
            connection.execute(
                """
                INSERT INTO tasks(
                    task_id, idempotency_key, request_fingerprint, owner_hash,
                    plan_json, decisions_json, plan_fingerprint, max_retries,
                    lease_duration_ms, retention_ms, status, created_at_ms, updated_at_ms
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    task_id,
                    normalized_key,
                    request_fingerprint,
                    owner_hash,
                    canonical_json(normalized_plan),
                    canonical_json(normalized_decisions),
                    plan_fingerprint,
                    normalized_retries,
                    normalized_lease,
                    normalized_retention,
                    "queued",
                    timestamp,
                    timestamp,
                ),
            )
            for item in normalized_matrix:
                shard_id = "shard-%s-%03d-%03d" % (
                    task_id[5:17], item["targetIndex"], item["replicaIndex"]
                )
                connection.execute(
                    """
                    INSERT INTO shards(
                        shard_id, task_id, target_id, target_index, replica_index,
                        selector_json, status, created_at_ms, updated_at_ms
                    ) VALUES(?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        shard_id,
                        task_id,
                        item["targetId"],
                        item["targetIndex"],
                        item["replicaIndex"],
                        canonical_json(item["selector"]),
                        "queued",
                        timestamp,
                        timestamp,
                    ),
                )
            self._append_event(
                connection,
                task_id,
                "task_submitted",
                timestamp,
                {
                    "idempotencyKey": normalized_key,
                    "planFingerprint": plan_fingerprint,
                    "shardCount": len(normalized_matrix),
                },
                known_secrets=(token,),
            )
            created = connection.execute(
                "SELECT * FROM tasks WHERE task_id = ?", (task_id,)
            ).fetchone()
            payload = self._task_payload(created, idempotent=False)
            payload["ownerToken"] = token
            return payload

    @staticmethod
    def _task_payload(row: Mapping[str, Any], idempotent: bool = False) -> Dict[str, Any]:
        return {
            "schemaVersion": TASK_SCHEMA,
            "taskId": row["task_id"],
            "idempotencyKey": row["idempotency_key"],
            "planFingerprint": row["plan_fingerprint"],
            "status": row["status"],
            "cancelRequested": bool(row["cancel_requested"]),
            "createdAt": row["created_at_ms"],
            "updatedAt": row["updated_at_ms"],
            "finishedAt": row["finished_at_ms"],
            "idempotent": idempotent,
        }

    def _recover_expired_in_transaction(
        self, connection: sqlite3.Connection, timestamp: int
    ) -> Dict[str, int]:
        counts = {"requeued": 0, "terminated": 0}
        rows = connection.execute(
            """
            SELECT a.*, t.max_retries, t.cancel_requested, s.status AS shard_status
            FROM attempts a
            JOIN tasks t ON t.task_id = a.task_id
            JOIN shards s ON s.shard_id = a.shard_id
            WHERE a.status IN ('leased','running') AND a.lease_expires_ms <= ?
            ORDER BY a.created_at_ms, a.attempt_id
            """,
            (timestamp,),
        ).fetchall()
        for attempt in rows:
            connection.execute(
                """
                UPDATE devices SET lease_id=NULL, lease_task_id=NULL, lease_shard_id=NULL,
                    lease_expires_ms=NULL, consecutive_failures=consecutive_failures+1,
                    circuit_open_until_ms=CASE
                        WHEN consecutive_failures + 1 >= ? THEN ? ELSE circuit_open_until_ms END,
                    updated_at_ms=?
                WHERE device_id=? AND lease_id=? AND generation=?
                """,
                (
                    CIRCUIT_FAILURE_THRESHOLD,
                    timestamp + CIRCUIT_OPEN_MS,
                    timestamp,
                    attempt["device_id"],
                    attempt["lease_id"],
                    attempt["owner_generation"],
                ),
            )
            connection.execute(
                """
                UPDATE attempts SET status='expired', failure_category='lease_expired',
                    finished_at_ms=? WHERE attempt_id=? AND status IN ('leased','running')
                """,
                (timestamp, attempt["attempt_id"]),
            )
            retry = (
                not bool(attempt["cancel_requested"])
                and attempt["attempt_number"] <= attempt["max_retries"]
                and attempt["shard_status"] not in SHARD_TERMINAL
            )
            if retry:
                backoff = self._retry_backoff(attempt["attempt_number"])
                connection.execute(
                    """
                    UPDATE shards SET status='queued', current_attempt_id=NULL,
                        assigned_device_id=NULL, owner_generation=NULL, lease_id=NULL,
                        lease_expires_ms=NULL, next_attempt_ms=?, failure_category='lease_expired',
                        updated_at_ms=?
                    WHERE shard_id=? AND status IN ('leased','running')
                    """,
                    (timestamp + backoff, timestamp, attempt["shard_id"]),
                )
                counts["requeued"] += 1
                outcome = "requeued"
            else:
                target = "cancelled" if bool(attempt["cancel_requested"]) else "not_tested"
                connection.execute(
                    """
                    UPDATE shards SET status=?, result_status=?, failure_category='lease_expired',
                        current_attempt_id=NULL, assigned_device_id=NULL, owner_generation=NULL,
                        lease_id=NULL, lease_expires_ms=NULL, updated_at_ms=?, finished_at_ms=?
                    WHERE shard_id=? AND status IN ('leased','running')
                    """,
                    (target, target, timestamp, timestamp, attempt["shard_id"]),
                )
                counts["terminated"] += 1
                outcome = target
            self._append_event(
                connection,
                attempt["task_id"],
                "lease_expired",
                timestamp,
                {
                    "attemptId": attempt["attempt_id"],
                    "deviceId": attempt["device_id"],
                    "ownerGeneration": attempt["owner_generation"],
                    "outcome": outcome,
                },
                shard_id=attempt["shard_id"],
                attempt_id=attempt["attempt_id"],
            )
            self._refresh_task(connection, attempt["task_id"], timestamp)
        return counts

    @staticmethod
    def _retry_backoff(attempt_number: int) -> int:
        return min(RETRY_BACKOFF_MAX_MS, RETRY_BACKOFF_BASE_MS * (2 ** max(0, attempt_number - 1)))

    def recover_expired(self, now_ms: Optional[int] = None) -> Dict[str, int]:
        timestamp = _now_ms(now_ms)
        with self._transaction() as connection:
            return self._recover_expired_in_transaction(connection, timestamp)

    def claim_next(
        self, worker_id: str, now_ms: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        timestamp = _now_ms(now_ms)
        normalized_worker = _identifier(worker_id, "worker id")
        with self._transaction() as connection:
            self._recover_expired_in_transaction(connection, timestamp)
            shards = connection.execute(
                """
                SELECT s.*, t.plan_json, t.decisions_json, t.plan_fingerprint,
                    t.lease_duration_ms, t.status AS task_status
                FROM shards s JOIN tasks t ON t.task_id=s.task_id
                WHERE s.status='queued' AND s.next_attempt_ms <= ?
                    AND t.status IN ('queued','running') AND t.cancel_requested=0
                ORDER BY t.created_at_ms, s.target_index, s.replica_index, s.shard_id
                """,
                (timestamp,),
            ).fetchall()
            devices = connection.execute(
                """
                SELECT * FROM devices
                WHERE health='healthy' AND lease_id IS NULL AND circuit_open_until_ms <= ?
                ORDER BY last_seen_ms, device_id
                """,
                (timestamp,),
            ).fetchall()
            for shard in shards:
                selector = json.loads(shard["selector_json"])
                device = next((item for item in devices if _device_matches(item, selector)), None)
                if device is None:
                    continue
                lease_id = "lease-%s" % uuid.uuid4().hex
                attempt_id = "attempt-%s" % uuid.uuid4().hex
                generation = device["generation"] + 1
                expires = timestamp + shard["lease_duration_ms"]
                updated = connection.execute(
                    """
                    UPDATE devices SET generation=?, lease_id=?, lease_task_id=?,
                        lease_shard_id=?, lease_expires_ms=?, updated_at_ms=?
                    WHERE device_id=? AND lease_id IS NULL AND generation=?
                    """,
                    (
                        generation,
                        lease_id,
                        shard["task_id"],
                        shard["shard_id"],
                        expires,
                        timestamp,
                        device["device_id"],
                        device["generation"],
                    ),
                ).rowcount
                if updated != 1:
                    continue
                attempt_number = shard["attempt_count"] + 1
                connection.execute(
                    """
                    INSERT INTO attempts(
                        attempt_id, task_id, shard_id, attempt_number, worker_id,
                        device_id, serial, lease_id, owner_generation, lease_expires_ms,
                        status, created_at_ms
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        attempt_id,
                        shard["task_id"],
                        shard["shard_id"],
                        attempt_number,
                        normalized_worker,
                        device["device_id"],
                        device["serial"],
                        lease_id,
                        generation,
                        expires,
                        "leased",
                        timestamp,
                    ),
                )
                connection.execute(
                    """
                    UPDATE shards SET status='leased', attempt_count=?, current_attempt_id=?,
                        assigned_device_id=?, owner_generation=?, lease_id=?, lease_expires_ms=?,
                        updated_at_ms=? WHERE shard_id=? AND status='queued'
                    """,
                    (
                        attempt_number,
                        attempt_id,
                        device["device_id"],
                        generation,
                        lease_id,
                        expires,
                        timestamp,
                        shard["shard_id"],
                    ),
                )
                connection.execute(
                    "UPDATE tasks SET status='running', updated_at_ms=? WHERE task_id=? AND status='queued'",
                    (timestamp, shard["task_id"]),
                )
                self._append_event(
                    connection,
                    shard["task_id"],
                    "assignment_claimed",
                    timestamp,
                    {
                        "attemptId": attempt_id,
                        "workerId": normalized_worker,
                        "deviceId": device["device_id"],
                        "leaseId": lease_id,
                        "ownerGeneration": generation,
                        "leaseExpiresAt": expires,
                    },
                    shard_id=shard["shard_id"],
                    attempt_id=attempt_id,
                )
                return {
                    "schemaVersion": ASSIGNMENT_SCHEMA,
                    "taskId": shard["task_id"],
                    "shardId": shard["shard_id"],
                    "targetId": shard["target_id"],
                    "replicaIndex": shard["replica_index"],
                    "attemptId": attempt_id,
                    "attemptNumber": attempt_number,
                    "workerId": normalized_worker,
                    "deviceId": device["device_id"],
                    "serial": device["serial"],
                    "leaseId": lease_id,
                    "ownerGeneration": generation,
                    "leaseExpiresAt": expires,
                    "leaseDurationMs": shard["lease_duration_ms"],
                    "planFingerprint": shard["plan_fingerprint"],
                    "plan": json.loads(shard["plan_json"]),
                    "decisions": json.loads(shard["decisions_json"]),
                }
            return None

    def _active_attempt(
        self,
        connection: sqlite3.Connection,
        assignment: Mapping[str, Any],
        timestamp: int,
    ) -> sqlite3.Row:
        required = (
            "taskId", "shardId", "attemptId", "deviceId", "leaseId", "ownerGeneration"
        )
        if any(field not in assignment for field in required):
            raise ManagedExecutionError("invalid_assignment", "任务分配标识不完整")
        attempt = connection.execute(
            "SELECT * FROM attempts WHERE attempt_id=?",
            (assignment["attemptId"],),
        ).fetchone()
        device = connection.execute(
            "SELECT * FROM devices WHERE device_id=?",
            (assignment["deviceId"],),
        ).fetchone()
        valid = (
            attempt is not None
            and attempt["status"] in ATTEMPT_ACTIVE
            and attempt["task_id"] == assignment["taskId"]
            and attempt["shard_id"] == assignment["shardId"]
            and attempt["device_id"] == assignment["deviceId"]
            and attempt["lease_id"] == assignment["leaseId"]
            and attempt["owner_generation"] == assignment["ownerGeneration"]
            and attempt["lease_expires_ms"] > timestamp
            and device is not None
            and device["lease_id"] == assignment["leaseId"]
            and device["generation"] == assignment["ownerGeneration"]
            and device["lease_task_id"] == assignment["taskId"]
            and device["lease_shard_id"] == assignment["shardId"]
            and device["lease_expires_ms"] > timestamp
        )
        if not valid:
            raise ManagedExecutionError(
                "stale_assignment", "任务分配不再持有对应的准确设备代次"
            )
        return attempt

    def start_attempt(
        self, assignment: Mapping[str, Any], now_ms: Optional[int] = None
    ) -> Dict[str, Any]:
        timestamp = _now_ms(now_ms)
        with self._transaction() as connection:
            attempt = self._active_attempt(connection, assignment, timestamp)
            if attempt["status"] == "leased":
                connection.execute(
                    "UPDATE attempts SET status='running', started_at_ms=? WHERE attempt_id=?",
                    (timestamp, attempt["attempt_id"]),
                )
                connection.execute(
                    "UPDATE shards SET status='running', updated_at_ms=? WHERE shard_id=?",
                    (timestamp, attempt["shard_id"]),
                )
                self._append_event(
                    connection,
                    attempt["task_id"],
                    "attempt_started",
                    timestamp,
                    {"attemptId": attempt["attempt_id"]},
                    shard_id=attempt["shard_id"],
                    attempt_id=attempt["attempt_id"],
                )
            return {"attemptId": attempt["attempt_id"], "status": "running"}

    def heartbeat(
        self, assignment: Mapping[str, Any], now_ms: Optional[int] = None
    ) -> Dict[str, Any]:
        timestamp = _now_ms(now_ms)
        with self._transaction() as connection:
            attempt = self._active_attempt(connection, assignment, timestamp)
            task = connection.execute(
                "SELECT cancel_requested, lease_duration_ms FROM tasks WHERE task_id=?",
                (attempt["task_id"],),
            ).fetchone()
            if bool(task["cancel_requested"]):
                raise ManagedExecutionError("task_cancelled", "任务取消已阻断心跳续租")
            expires = timestamp + task["lease_duration_ms"]
            connection.execute(
                "UPDATE attempts SET lease_expires_ms=? WHERE attempt_id=?",
                (expires, attempt["attempt_id"]),
            )
            connection.execute(
                """
                UPDATE devices SET lease_expires_ms=?, updated_at_ms=?
                WHERE device_id=? AND lease_id=? AND generation=?
                """,
                (
                    expires,
                    timestamp,
                    attempt["device_id"],
                    attempt["lease_id"],
                    attempt["owner_generation"],
                ),
            )
            connection.execute(
                "UPDATE shards SET lease_expires_ms=?, updated_at_ms=? WHERE shard_id=?",
                (expires, timestamp, attempt["shard_id"]),
            )
            return {"attemptId": attempt["attempt_id"], "leaseExpiresAt": expires}

    def _release_device(
        self, connection: sqlite3.Connection, attempt: Mapping[str, Any], timestamp: int,
        succeeded: bool
    ) -> None:
        connection.execute(
            """
            UPDATE devices SET lease_id=NULL, lease_task_id=NULL, lease_shard_id=NULL,
                lease_expires_ms=NULL,
                consecutive_failures=CASE WHEN ? THEN 0 ELSE consecutive_failures END,
                circuit_open_until_ms=CASE WHEN ? THEN 0 ELSE circuit_open_until_ms END,
                updated_at_ms=?
            WHERE device_id=? AND lease_id=? AND generation=?
            """,
            (
                1 if succeeded else 0,
                1 if succeeded else 0,
                timestamp,
                attempt["device_id"],
                attempt["lease_id"],
                attempt["owner_generation"],
            ),
        )

    def complete_assignment(
        self,
        assignment: Mapping[str, Any],
        status: str,
        failure_category: Optional[str] = None,
        report_path: Optional[str] = None,
        report: Optional[Mapping[str, Any]] = None,
        evidence_digest: Optional[str] = None,
        now_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        timestamp = _now_ms(now_ms)
        if status not in RESULT_STATUSES:
            raise ManagedExecutionError("invalid_result", "不支持该验证结果状态")
        if evidence_digest is not None and SHA256_PATTERN.fullmatch(evidence_digest) is None:
            raise ManagedExecutionError("invalid_evidence", "证据摘要必须是 SHA-256")
        normalized_report = sanitize(_json_object(report or {}, "verification report"))
        outcome = normalized_report.get("outcomeFingerprint")
        if outcome is not None and (
            not isinstance(outcome, str) or SHA256_PATTERN.fullmatch(outcome) is None
        ):
            raise ManagedExecutionError("invalid_report", "验证结果指纹无效")
        with self._transaction() as connection:
            attempt = self._active_attempt(connection, assignment, timestamp)
            task = connection.execute(
                "SELECT cancel_requested FROM tasks WHERE task_id=?", (attempt["task_id"],)
            ).fetchone()
            if bool(task["cancel_requested"]):
                raise ManagedExecutionError("stale_assignment", "已取消任务拒绝提交完成结果")
            connection.execute(
                """
                UPDATE attempts SET status=?, failure_category=?, report_path=?, report_json=?,
                    verification_outcome_fingerprint=?, evidence_digest=?, finished_at_ms=?
                WHERE attempt_id=? AND status IN ('leased','running')
                """,
                (
                    status,
                    failure_category,
                    report_path,
                    canonical_json(normalized_report),
                    outcome,
                    evidence_digest,
                    timestamp,
                    attempt["attempt_id"],
                ),
            )
            connection.execute(
                """
                UPDATE shards SET status=?, result_status=?, failure_category=?,
                    current_attempt_id=NULL, assigned_device_id=?, owner_generation=NULL,
                    lease_id=NULL, lease_expires_ms=NULL, updated_at_ms=?, finished_at_ms=?
                WHERE shard_id=? AND status IN ('leased','running')
                """,
                (
                    status,
                    status,
                    failure_category,
                    attempt["device_id"],
                    timestamp,
                    timestamp,
                    attempt["shard_id"],
                ),
            )
            self._release_device(connection, attempt, timestamp, succeeded=True)
            self._append_event(
                connection,
                attempt["task_id"],
                "attempt_completed",
                timestamp,
                {
                    "attemptId": attempt["attempt_id"],
                    "status": status,
                    "failureCategory": failure_category,
                    "evidenceDigest": evidence_digest,
                },
                shard_id=attempt["shard_id"],
                attempt_id=attempt["attempt_id"],
            )
            task_status = self._refresh_task(connection, attempt["task_id"], timestamp)
            return {
                "taskId": attempt["task_id"],
                "shardId": attempt["shard_id"],
                "shardStatus": status,
                "taskStatus": task_status,
            }

    def fail_assignment(
        self,
        assignment: Mapping[str, Any],
        failure_category: str,
        retryable: bool,
        now_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        timestamp = _now_ms(now_ms)
        normalized_category = _identifier(failure_category, "failure category")
        with self._transaction() as connection:
            attempt = self._active_attempt(connection, assignment, timestamp)
            task = connection.execute(
                "SELECT max_retries, cancel_requested FROM tasks WHERE task_id=?",
                (attempt["task_id"],),
            ).fetchone()
            can_retry = (
                retryable
                and not bool(task["cancel_requested"])
                and attempt["attempt_number"] <= task["max_retries"]
            )
            attempt_status = "retryable_failed" if can_retry else "failed"
            connection.execute(
                """
                UPDATE attempts SET status=?, failure_category=?, finished_at_ms=?
                WHERE attempt_id=? AND status IN ('leased','running')
                """,
                (attempt_status, normalized_category, timestamp, attempt["attempt_id"]),
            )
            failures = connection.execute(
                "SELECT consecutive_failures FROM devices WHERE device_id=?",
                (attempt["device_id"],),
            ).fetchone()["consecutive_failures"] + 1
            connection.execute(
                """
                UPDATE devices SET lease_id=NULL, lease_task_id=NULL, lease_shard_id=NULL,
                    lease_expires_ms=NULL, consecutive_failures=?,
                    circuit_open_until_ms=CASE WHEN ? >= ? THEN ? ELSE circuit_open_until_ms END,
                    updated_at_ms=?
                WHERE device_id=? AND lease_id=? AND generation=?
                """,
                (
                    failures,
                    failures,
                    CIRCUIT_FAILURE_THRESHOLD,
                    timestamp + CIRCUIT_OPEN_MS,
                    timestamp,
                    attempt["device_id"],
                    attempt["lease_id"],
                    attempt["owner_generation"],
                ),
            )
            if can_retry:
                shard_status = "queued"
                next_attempt = timestamp + self._retry_backoff(attempt["attempt_number"])
                connection.execute(
                    """
                    UPDATE shards SET status='queued', current_attempt_id=NULL,
                        assigned_device_id=NULL, owner_generation=NULL, lease_id=NULL,
                        lease_expires_ms=NULL, next_attempt_ms=?, failure_category=?, updated_at_ms=?
                    WHERE shard_id=? AND status IN ('leased','running')
                    """,
                    (next_attempt, normalized_category, timestamp, attempt["shard_id"]),
                )
            else:
                shard_status = "cancelled" if bool(task["cancel_requested"]) else "not_tested"
                connection.execute(
                    """
                    UPDATE shards SET status=?, result_status=?, failure_category=?,
                        current_attempt_id=NULL, assigned_device_id=NULL, owner_generation=NULL,
                        lease_id=NULL, lease_expires_ms=NULL, updated_at_ms=?, finished_at_ms=?
                    WHERE shard_id=? AND status IN ('leased','running')
                    """,
                    (
                        shard_status,
                        shard_status,
                        normalized_category,
                        timestamp,
                        timestamp,
                        attempt["shard_id"],
                    ),
                )
            self._append_event(
                connection,
                attempt["task_id"],
                "attempt_failed",
                timestamp,
                {
                    "attemptId": attempt["attempt_id"],
                    "failureCategory": normalized_category,
                    "retryable": can_retry,
                    "shardStatus": shard_status,
                },
                shard_id=attempt["shard_id"],
                attempt_id=attempt["attempt_id"],
            )
            task_status = self._refresh_task(connection, attempt["task_id"], timestamp)
            return {
                "taskId": attempt["task_id"],
                "shardId": attempt["shard_id"],
                "shardStatus": shard_status,
                "taskStatus": task_status,
            }

    def cancel_task(
        self, task_id: str, owner_token: str, now_ms: Optional[int] = None
    ) -> Dict[str, Any]:
        timestamp = _now_ms(now_ms)
        normalized_id = _identifier(task_id, "task id")
        token = _owner_token(owner_token)
        with self._transaction() as connection:
            task = connection.execute(
                "SELECT * FROM tasks WHERE task_id=?", (normalized_id,)
            ).fetchone()
            if task is None:
                raise ManagedExecutionError("task_not_found", "未找到托管任务")
            if not hmac.compare_digest(task["owner_hash"], _owner_hash(normalized_id, token)):
                raise ManagedExecutionError("owner_mismatch", "任务所有者凭据不匹配")
            if task["status"] in TASK_TERMINAL:
                return self._task_payload(task, idempotent=True)
            active = connection.execute(
                """
                SELECT * FROM attempts WHERE task_id=? AND status IN ('leased','running')
                ORDER BY created_at_ms
                """,
                (normalized_id,),
            ).fetchall()
            for attempt in active:
                connection.execute(
                    """
                    UPDATE attempts SET status='cancelled', failure_category='cancelled_by_owner',
                        finished_at_ms=? WHERE attempt_id=? AND status IN ('leased','running')
                    """,
                    (timestamp, attempt["attempt_id"]),
                )
                self._release_device(connection, attempt, timestamp, succeeded=False)
            connection.execute(
                """
                UPDATE shards SET status='cancelled', result_status='cancelled',
                    failure_category='cancelled_by_owner', current_attempt_id=NULL,
                    owner_generation=NULL, lease_id=NULL, lease_expires_ms=NULL,
                    updated_at_ms=?, finished_at_ms=?
                WHERE task_id=? AND status NOT IN ('passed','failed','not_tested','cancelled')
                """,
                (timestamp, timestamp, normalized_id),
            )
            connection.execute(
                """
                UPDATE tasks SET cancel_requested=1, status='cancelled', updated_at_ms=?,
                    finished_at_ms=? WHERE task_id=?
                """,
                (timestamp, timestamp, normalized_id),
            )
            self._append_event(
                connection,
                normalized_id,
                "task_cancelled",
                timestamp,
                {"fencedAttempts": len(active)},
                known_secrets=(token,),
            )
            updated = connection.execute(
                "SELECT * FROM tasks WHERE task_id=?", (normalized_id,)
            ).fetchone()
            return self._task_payload(updated)

    def _refresh_task(
        self, connection: sqlite3.Connection, task_id: str, timestamp: int
    ) -> str:
        task = connection.execute(
            "SELECT status, cancel_requested FROM tasks WHERE task_id=?", (task_id,)
        ).fetchone()
        if task["status"] in TASK_TERMINAL:
            return task["status"]
        states = [
            row["status"]
            for row in connection.execute(
                "SELECT status FROM shards WHERE task_id=? ORDER BY target_index, replica_index",
                (task_id,),
            )
        ]
        if states and all(item in SHARD_TERMINAL for item in states):
            if "failed" in states:
                status = "failed"
            elif "not_tested" in states:
                status = "not_tested"
            elif "cancelled" in states:
                status = "cancelled"
            else:
                status = "passed"
            connection.execute(
                "UPDATE tasks SET status=?, updated_at_ms=?, finished_at_ms=? WHERE task_id=?",
                (status, timestamp, timestamp, task_id),
            )
            self._append_event(
                connection,
                task_id,
                "task_finished",
                timestamp,
                {"status": status},
            )
            return status
        status = "running" if any(item in {"leased", "running"} for item in states) else "queued"
        if task["status"] != status:
            connection.execute(
                "UPDATE tasks SET status=?, updated_at_ms=? WHERE task_id=?",
                (status, timestamp, task_id),
            )
        return status

    def task_status(self, task_id: str) -> Dict[str, Any]:
        normalized = _identifier(task_id, "task id")
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT * FROM tasks WHERE task_id=?", (normalized,)
            ).fetchone()
            if row is None:
                raise ManagedExecutionError("task_not_found", "未找到托管任务")
            payload = self._task_payload(row)
            counts = {
                item["status"]: item["count"]
                for item in connection.execute(
                    "SELECT status, COUNT(*) AS count FROM shards WHERE task_id=? GROUP BY status",
                    (normalized,),
                )
            }
            payload["shardCounts"] = counts
            return payload
        finally:
            connection.close()

    def task_events(self, task_id: str, after_sequence: int = 0) -> List[Dict[str, Any]]:
        normalized = _identifier(task_id, "task id")
        normalized_after = _integer(after_sequence, "event cursor", 0, 2**63 - 1)
        connection = self._connect()
        try:
            if connection.execute(
                "SELECT 1 FROM tasks WHERE task_id=?", (normalized,)
            ).fetchone() is None:
                raise ManagedExecutionError("task_not_found", "未找到托管任务")
            return [
                {
                    "sequence": row["sequence"],
                    "taskSequence": row["task_sequence"],
                    "taskId": row["task_id"],
                    "shardId": row["shard_id"],
                    "attemptId": row["attempt_id"],
                    "type": row["event_type"],
                    "timestamp": row["timestamp_ms"],
                    "content": json.loads(row["content_json"]),
                }
                for row in connection.execute(
                    """
                    SELECT * FROM events WHERE task_id=? AND task_sequence > ?
                    ORDER BY task_sequence
                    """,
                    (normalized, normalized_after),
                )
            ]
        finally:
            connection.close()

    def task_report(self, task_id: str) -> Dict[str, Any]:
        normalized = _identifier(task_id, "task id")
        connection = self._connect()
        try:
            task = connection.execute(
                "SELECT * FROM tasks WHERE task_id=?", (normalized,)
            ).fetchone()
            if task is None:
                raise ManagedExecutionError("task_not_found", "未找到托管任务")
            shards: List[Dict[str, Any]] = []
            semantic_shards: List[Dict[str, Any]] = []
            for shard in connection.execute(
                """
                SELECT * FROM shards WHERE task_id=?
                ORDER BY target_index, replica_index, shard_id
                """,
                (normalized,),
            ):
                attempts = []
                for attempt in connection.execute(
                    "SELECT * FROM attempts WHERE shard_id=? ORDER BY attempt_number",
                    (shard["shard_id"],),
                ):
                    attempts.append(
                        {
                            "attemptId": attempt["attempt_id"],
                            "attemptNumber": attempt["attempt_number"],
                            "workerId": attempt["worker_id"],
                            "deviceId": attempt["device_id"],
                            "serial": attempt["serial"],
                            "ownerGeneration": attempt["owner_generation"],
                            "status": attempt["status"],
                            "failureCategory": attempt["failure_category"],
                            "verificationOutcomeFingerprint": attempt[
                                "verification_outcome_fingerprint"
                            ],
                            "evidenceDigest": attempt["evidence_digest"],
                            "reportPath": attempt["report_path"],
                            "evidencePurgedAt": attempt["evidence_purged_at_ms"],
                            "createdAt": attempt["created_at_ms"],
                            "startedAt": attempt["started_at_ms"],
                            "finishedAt": attempt["finished_at_ms"],
                        }
                    )
                shard_payload = {
                    "shardId": shard["shard_id"],
                    "targetId": shard["target_id"],
                    "replicaIndex": shard["replica_index"],
                    "selector": json.loads(shard["selector_json"]),
                    "status": shard["status"],
                    "deviceId": shard["assigned_device_id"],
                    "failureCategory": shard["failure_category"],
                    "attempts": attempts,
                }
                shards.append(shard_payload)
                semantic_shards.append(
                    {
                        "targetId": shard["target_id"],
                        "replicaIndex": shard["replica_index"],
                        "status": shard["status"],
                        "failureCategory": shard["failure_category"],
                        "outcomes": [
                            item["verificationOutcomeFingerprint"]
                            for item in attempts
                            if item["verificationOutcomeFingerprint"] is not None
                        ],
                    }
                )
            exit_codes = {"passed": 0, "failed": 2, "not_tested": 3, "cancelled": 130}
            return {
                "schemaVersion": REPORT_SCHEMA,
                "taskId": normalized,
                "planFingerprint": task["plan_fingerprint"],
                "status": task["status"],
                "terminal": task["status"] in TASK_TERMINAL,
                "exitCode": exit_codes.get(task["status"], 4),
                "outcomeFingerprint": fingerprint(
                    {
                        "planFingerprint": task["plan_fingerprint"],
                        "status": task["status"],
                        "shards": semantic_shards,
                    }
                ),
                "shards": shards,
                "eventCount": connection.execute(
                    "SELECT COUNT(*) AS count FROM events WHERE task_id=?", (normalized,)
                ).fetchone()["count"],
                "createdAt": task["created_at_ms"],
                "finishedAt": task["finished_at_ms"],
            }
        finally:
            connection.close()

    def retention_candidates(self, now_ms: Optional[int] = None) -> List[Dict[str, Any]]:
        timestamp = _now_ms(now_ms)
        connection = self._connect()
        try:
            return [
                {
                    "taskId": row["task_id"],
                    "attemptId": row["attempt_id"],
                    "path": row["report_path"],
                    "evidenceDigest": row["evidence_digest"],
                }
                for row in connection.execute(
                    """
                    SELECT a.task_id, a.attempt_id, a.report_path, a.evidence_digest
                    FROM attempts a JOIN tasks t ON t.task_id=a.task_id
                    WHERE t.status IN ('passed','failed','not_tested','cancelled')
                        AND t.finished_at_ms + t.retention_ms <= ?
                        AND a.report_path IS NOT NULL AND a.evidence_purged_at_ms IS NULL
                    ORDER BY t.finished_at_ms, a.attempt_id
                    """,
                    (timestamp,),
                )
            ]
        finally:
            connection.close()

    def mark_evidence_purged(
        self, task_id: str, paths: Sequence[str], now_ms: Optional[int] = None
    ) -> Dict[str, Any]:
        timestamp = _now_ms(now_ms)
        normalized = _identifier(task_id, "task id")
        if not isinstance(paths, (list, tuple)) or not paths:
            raise ManagedExecutionError("invalid_contract", "证据路径不能为空")
        normalized_paths = [str(Path(item).expanduser()) for item in paths]
        with self._transaction() as connection:
            task = connection.execute(
                "SELECT status, finished_at_ms, retention_ms FROM tasks WHERE task_id=?",
                (normalized,),
            ).fetchone()
            if task is None:
                raise ManagedExecutionError("task_not_found", "未找到托管任务")
            if (
                task["status"] not in TASK_TERMINAL
                or task["finished_at_ms"] + task["retention_ms"] > timestamp
            ):
                raise ManagedExecutionError(
                    "retention_not_due", "原始证据尚不满足保留期清理条件"
                )
            updated = 0
            for path in normalized_paths:
                updated += connection.execute(
                    """
                    UPDATE attempts SET report_path=NULL, evidence_purged_at_ms=?
                    WHERE task_id=? AND report_path=? AND evidence_purged_at_ms IS NULL
                    """,
                    (timestamp, normalized, path),
                ).rowcount
            self._append_event(
                connection,
                normalized,
                "evidence_purged",
                timestamp,
                {"artifactCount": updated},
            )
            return {"taskId": normalized, "purged": updated}

    def health_summary(self) -> Dict[str, Any]:
        connection = self._connect()
        try:
            device_counts = {
                row["health"]: row["count"]
                for row in connection.execute(
                    "SELECT health, COUNT(*) AS count FROM devices GROUP BY health"
                )
            }
            task_counts = {
                row["status"]: row["count"]
                for row in connection.execute(
                    "SELECT status, COUNT(*) AS count FROM tasks GROUP BY status"
                )
            }
            active = connection.execute(
                "SELECT COUNT(*) AS count FROM attempts WHERE status IN ('leased','running')"
            ).fetchone()["count"]
            return {
                "ready": True,
                "schemaVersion": SCHEMA_VERSION,
                "database": str(self.database),
                "devices": device_counts,
                "tasks": task_counts,
                "activeAssignments": active,
            }
        finally:
            connection.close()


def _http_status(error: ManagedExecutionError) -> int:
    if error.code in {"task_not_found", "device_not_found", "not_found"}:
        return 404
    if error.code in {"owner_mismatch", "stale_assignment"}:
        return 403
    if error.code in {"idempotency_conflict", "serial_conflict"}:
        return 409
    return 400


def create_http_server(
    store: ManagedExecutionStore,
    bearer_token: str,
    host: str = "127.0.0.1",
    port: int = 0,
) -> ThreadingHTTPServer:
    """创建带鉴权和版本控制的托管执行 HTTP 服务。"""

    token = _owner_token(bearer_token)
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise ManagedExecutionError(
            "unsafe_bind", "托管接口只能绑定回环地址"
        )
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ManagedExecutionError("invalid_port", "托管接口端口无效")

    class ManagedRequestHandler(BaseHTTPRequestHandler):
        server_version = "SoloPiManagedExecution/1"

        def log_message(self, format: str, *args: Any) -> None:
            del format, args

        def _write(self, status: int, payload: Mapping[str, Any]) -> None:
            body = canonical_json(sanitize(dict(payload), (token,))).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _authenticated(self) -> bool:
            supplied = self.headers.get("Authorization", "")
            expected = "Bearer " + token
            if hmac.compare_digest(supplied, expected):
                return True
            self._write(401, {"success": False, "error": "unauthorized"})
            return False

        def _body(self) -> Dict[str, Any]:
            raw_length = self.headers.get("Content-Length")
            try:
                length = int(raw_length or "0")
            except ValueError as exc:
                raise ManagedExecutionError(
                    "invalid_request", "Content-Length 必须是整数"
                ) from exc
            if length <= 0 or length > MAX_HTTP_BODY_BYTES:
                raise ManagedExecutionError(
                    "invalid_request", "JSON 请求体为空或超过大小限制"
                )
            try:
                value = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ManagedExecutionError(
                    "invalid_request", "请求体必须是 UTF-8 JSON"
                ) from exc
            return _json_object(value, "请求体")

        def _execute(self, callback: Any) -> None:
            try:
                payload = callback()
                self._write(200, {"success": True, **payload})
            except ManagedExecutionError as exc:
                self._write(
                    _http_status(exc),
                    {"success": False, "error": str(exc), "errorCode": exc.code, **exc.details},
                )
            except Exception:
                self._write(500, {"success": False, "error": "internal_error"})

        def do_GET(self) -> None:
            parsed = urlsplit(self.path)
            if parsed.path == "/health":
                self._execute(lambda: store.health_summary())
                return
            if not self._authenticated():
                return
            segments = [item for item in parsed.path.split("/") if item]
            if segments == ["v1", "devices"]:
                self._execute(lambda: {"devices": store.list_devices()})
                return
            if len(segments) >= 3 and segments[:2] == ["v1", "tasks"]:
                task_id = segments[2]
                if len(segments) == 3:
                    self._execute(lambda: store.task_status(task_id))
                    return
                if len(segments) == 4 and segments[3] == "events":
                    query = parse_qs(parsed.query)
                    try:
                        after = int(query.get("after", ["0"])[0])
                    except ValueError:
                        self._write(400, {"success": False, "error": "invalid after sequence"})
                        return
                    self._execute(
                        lambda: {"taskId": task_id, "events": store.task_events(task_id, after)}
                    )
                    return
                if len(segments) == 4 and segments[3] == "report":
                    self._execute(lambda: store.task_report(task_id))
                    return
            self._write(404, {"success": False, "error": "not_found"})

        def do_POST(self) -> None:
            if not self._authenticated():
                return
            parsed = urlsplit(self.path)
            segments = [item for item in parsed.path.split("/") if item]

            def route() -> Dict[str, Any]:
                body = self._body()
                if segments == ["v1", "devices"]:
                    return store.register_device(
                        device_id=body.get("deviceId"),
                        serial=body.get("serial"),
                        platform=body.get("platform", "android"),
                        api_level=body.get("apiLevel"),
                        capabilities=body.get("capabilities", []),
                        labels=body.get("labels", {}),
                        health=body.get("health", "healthy"),
                    )
                if segments == ["v1", "tasks"]:
                    return store.submit_task(
                        plan=body.get("plan"),
                        matrix=body.get("matrix"),
                        idempotency_key=body.get("idempotencyKey"),
                        owner_token=body.get("ownerToken"),
                        decisions=body.get("decisions", {}),
                        max_retries=body.get("maxRetries", 1),
                        lease_duration_ms=body.get(
                            "leaseDurationMs", DEFAULT_LEASE_DURATION_MS
                        ),
                        retention_ms=body.get("retentionMs", DEFAULT_RETENTION_MS),
                    )
                if segments == ["v1", "recover"]:
                    return store.recover_expired()
                if (
                    len(segments) == 4
                    and segments[:2] == ["v1", "tasks"]
                    and segments[3] == "cancel"
                ):
                    return store.cancel_task(segments[2], body.get("ownerToken"))
                raise ManagedExecutionError("not_found", "未找到 HTTP 资源")

            self._execute(route)

    return ThreadingHTTPServer((host, port), ManagedRequestHandler)
