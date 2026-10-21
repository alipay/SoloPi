import concurrent.futures
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = (
    REPO_ROOT
    / "solopi-harness-cli"
    / "src"
    / "solopi_harness"
    / "managed_execution.py"
)
SPEC = importlib.util.spec_from_file_location("managed_execution", MODULE_PATH)
managed_execution = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = managed_execution
SPEC.loader.exec_module(managed_execution)


class ManagedExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temporary_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_dir.name)
        self.database = self.root / "managed.sqlite"
        self.store = managed_execution.ManagedExecutionStore(self.database)

    def tearDown(self):
        self.temporary_dir.cleanup()

    @staticmethod
    def plan():
        return {
            "schemaVersion": "solopi.ai.verification-plan/v1",
            "planFingerprint": "a" * 64,
            "intent": {"requirement": {"id": "managed-counter"}},
        }

    @staticmethod
    def matrix(replicas=1, selector=None):
        return [
            {
                "id": "android-main",
                "replicas": replicas,
                "selector": selector or {"platform": "android"},
            }
        ]

    def register(
        self,
        device_id="pixel-8",
        serial="SERIAL-1",
        api_level=35,
        capabilities=None,
        labels=None,
        health="healthy",
        now_ms=1,
    ):
        return self.store.register_device(
            device_id=device_id,
            serial=serial,
            platform="android",
            api_level=api_level,
            capabilities=capabilities or ["agent", "verification"],
            labels=labels or {"tier": "physical"},
            health=health,
            now_ms=now_ms,
        )

    def submit(
        self,
        key="ci-build-1",
        owner_token="owner-token-1234567890abcdef",
        matrix=None,
        max_retries=1,
        lease_duration_ms=1000,
        retention_ms=10000,
    ):
        return self.store.submit_task(
            plan=self.plan(),
            matrix=matrix or self.matrix(),
            idempotency_key=key,
            owner_token=owner_token,
            decisions={},
            max_retries=max_retries,
            lease_duration_ms=lease_duration_ms,
            retention_ms=retention_ms,
            now_ms=10,
        )

    def test_submit_is_idempotent_and_rejects_conflicting_content(self):
        first = self.submit()
        second = self.submit()

        self.assertEqual(first["taskId"], second["taskId"])
        self.assertFalse(first["idempotent"])
        self.assertTrue(second["idempotent"])
        self.assertNotIn("ownerTokenHash", json.dumps(second))

        changed = self.plan()
        changed["planFingerprint"] = "b" * 64
        with self.assertRaises(managed_execution.ManagedExecutionError) as error:
            self.store.submit_task(
                plan=changed,
                matrix=self.matrix(),
                idempotency_key="ci-build-1",
                owner_token="owner-token-1234567890abcdef",
                now_ms=11,
            )
        self.assertEqual("idempotency_conflict", error.exception.code)

    def test_scheduler_matches_health_api_capabilities_and_labels(self):
        self.register(
            "old-emulator",
            "SERIAL-OLD",
            api_level=28,
            capabilities=["verification"],
            labels={"tier": "virtual"},
        )
        self.register(
            "offline-pixel",
            "SERIAL-OFFLINE",
            capabilities=["agent", "verification"],
            health="offline",
        )
        self.register()
        matrix = self.matrix(
            selector={
                "platform": "android",
                "minApiLevel": 34,
                "capabilities": ["agent"],
                "labels": {"tier": "physical"},
            }
        )
        task = self.submit(matrix=matrix)

        assignment = self.store.claim_next("worker-1", now_ms=20)

        self.assertEqual(task["taskId"], assignment["taskId"])
        self.assertEqual("pixel-8", assignment["deviceId"])
        self.assertEqual("SERIAL-1", assignment["serial"])
        self.assertEqual(1, assignment["ownerGeneration"])

    def test_expired_generation_is_recovered_and_cannot_complete_successor(self):
        self.register()
        task = self.submit(max_retries=1, lease_duration_ms=1000)
        first = self.store.claim_next("worker-old", now_ms=20)
        self.store.start_attempt(first, now_ms=21)

        recovered = self.store.recover_expired(now_ms=1021)
        second = self.store.claim_next("worker-new", now_ms=2021)

        self.assertEqual(1, recovered["requeued"])
        self.assertEqual(first["deviceId"], second["deviceId"])
        self.assertEqual(first["ownerGeneration"] + 1, second["ownerGeneration"])
        with self.assertRaises(managed_execution.ManagedExecutionError) as heartbeat_error:
            self.store.heartbeat(first, now_ms=2022)
        self.assertEqual("stale_assignment", heartbeat_error.exception.code)
        with self.assertRaises(managed_execution.ManagedExecutionError) as complete_error:
            self.store.complete_assignment(first, "passed", now_ms=2022)
        self.assertEqual("stale_assignment", complete_error.exception.code)

        self.store.complete_assignment(
            second,
            "passed",
            report={"outcomeFingerprint": "c" * 64},
            evidence_digest="d" * 64,
            now_ms=2030,
        )
        self.assertEqual("passed", self.store.task_status(task["taskId"])["status"])

    def test_expired_lease_cannot_be_resurrected_before_recovery_runs(self):
        self.register()
        self.submit(max_retries=1, lease_duration_ms=1000)
        assignment = self.store.claim_next("worker-late", now_ms=20)

        with self.assertRaises(managed_execution.ManagedExecutionError) as heartbeat:
            self.store.heartbeat(assignment, now_ms=1020)
        self.assertEqual("stale_assignment", heartbeat.exception.code)
        with self.assertRaises(managed_execution.ManagedExecutionError) as complete:
            self.store.complete_assignment(assignment, "passed", now_ms=1020)
        self.assertEqual("stale_assignment", complete.exception.code)

        recovered = self.store.recover_expired(now_ms=1020)
        self.assertEqual(1, recovered["requeued"])

    def test_cancel_requires_exact_owner_and_fences_running_attempt(self):
        self.register()
        task = self.submit()
        assignment = self.store.claim_next("worker-1", now_ms=20)

        with self.assertRaises(managed_execution.ManagedExecutionError) as error:
            self.store.cancel_task(task["taskId"], "foreign-owner-1234567890", now_ms=21)
        self.assertEqual("owner_mismatch", error.exception.code)

        cancelled = self.store.cancel_task(
            task["taskId"], "owner-token-1234567890abcdef", now_ms=22
        )
        self.assertEqual("cancelled", cancelled["status"])
        with self.assertRaises(managed_execution.ManagedExecutionError) as stale:
            self.store.complete_assignment(assignment, "passed", now_ms=23)
        self.assertEqual("stale_assignment", stale.exception.code)

        successor = self.submit(
            key="ci-build-2", owner_token="successor-owner-1234567890"
        )
        successor_assignment = self.store.claim_next("worker-2", now_ms=24)
        self.assertEqual(successor["taskId"], successor_assignment["taskId"])
        with self.assertRaises(managed_execution.ManagedExecutionError) as old_owner:
            self.store.cancel_task(
                successor["taskId"], "owner-token-1234567890abcdef", now_ms=25
            )
        self.assertEqual("owner_mismatch", old_owner.exception.code)

    def test_retry_exhaustion_is_not_tested_and_attempt_history_is_retained(self):
        self.register()
        task = self.submit(max_retries=1)
        first = self.store.claim_next("worker-1", now_ms=20)
        retry = self.store.fail_assignment(
            first, "device_offline", retryable=True, now_ms=21
        )
        self.assertEqual("queued", retry["shardStatus"])

        second = self.store.claim_next("worker-2", now_ms=1021)
        terminal = self.store.fail_assignment(
            second, "device_offline", retryable=True, now_ms=1022
        )

        self.assertEqual("not_tested", terminal["shardStatus"])
        report = self.store.task_report(task["taskId"])
        self.assertEqual("not_tested", report["status"])
        self.assertEqual(3, report["exitCode"])
        self.assertEqual(2, len(report["shards"][0]["attempts"]))
        self.assertEqual(
            ["retryable_failed", "failed"],
            [item["status"] for item in report["shards"][0]["attempts"]],
        )

    def test_matrix_aggregate_and_terminal_result_are_stable(self):
        self.register("pixel-8", "SERIAL-1")
        self.register("pixel-7", "SERIAL-2")
        task = self.submit(matrix=self.matrix(replicas=2))
        first = self.store.claim_next("worker-1", now_ms=20)
        second = self.store.claim_next("worker-2", now_ms=20)
        self.assertNotEqual(first["deviceId"], second["deviceId"])

        self.store.complete_assignment(
            first,
            "passed",
            report={"outcomeFingerprint": "1" * 64},
            evidence_digest="2" * 64,
            now_ms=30,
        )
        self.store.complete_assignment(
            second,
            "failed",
            failure_category="oracle_mismatch",
            report={"outcomeFingerprint": "3" * 64},
            evidence_digest="4" * 64,
            now_ms=31,
        )

        report = self.store.task_report(task["taskId"])
        self.assertEqual("failed", report["status"])
        self.assertEqual(2, report["exitCode"])
        self.assertEqual({"passed", "failed"}, {item["status"] for item in report["shards"]})
        self.assertRegex(report["outcomeFingerprint"], r"^[0-9a-f]{64}$")
        with self.assertRaises(managed_execution.ManagedExecutionError) as terminal:
            self.store.complete_assignment(second, "passed", now_ms=32)
        self.assertEqual("stale_assignment", terminal.exception.code)

    def test_concurrent_claims_never_share_a_device_or_shard(self):
        self.register("pixel-8", "SERIAL-1")
        self.register("pixel-7", "SERIAL-2")
        self.submit(matrix=self.matrix(replicas=2))

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            assignments = list(
                executor.map(
                    lambda worker: self.store.claim_next(worker, now_ms=20),
                    ["worker-1", "worker-2"],
                )
            )

        self.assertEqual(2, len([item for item in assignments if item]))
        self.assertEqual(2, len({item["deviceId"] for item in assignments}))
        self.assertEqual(2, len({item["shardId"] for item in assignments}))

    def test_restart_recovery_uses_durable_database_and_append_only_events(self):
        self.register()
        task = self.submit(max_retries=0, lease_duration_ms=1000)
        assignment = self.store.claim_next("worker-before-crash", now_ms=20)
        self.store.start_attempt(assignment, now_ms=21)

        reopened = managed_execution.ManagedExecutionStore(self.database)
        recovery = reopened.recover_expired(now_ms=1021)
        status = reopened.task_status(task["taskId"])
        events = reopened.task_events(task["taskId"])

        self.assertEqual(1, recovery["terminated"])
        self.assertEqual("not_tested", status["status"])
        self.assertEqual(
            list(range(1, len(events) + 1)),
            [item["taskSequence"] for item in events],
        )
        encoded = json.dumps(events)
        self.assertNotIn("owner-token-1234567890abcdef", encoded)
        self.assertNotIn("ownerTokenHash", encoded)

    def test_retention_keeps_digest_after_raw_evidence_is_marked_purged(self):
        self.register()
        task = self.submit(retention_ms=1000)
        assignment = self.store.claim_next("worker-1", now_ms=20)
        report_path = self.root / "artifacts" / "report.json"
        report_path.parent.mkdir()
        report_path.write_text("{}", encoding="utf-8")
        self.store.complete_assignment(
            assignment,
            "passed",
            report_path=str(report_path),
            evidence_digest="e" * 64,
            now_ms=30,
        )

        candidates = self.store.retention_candidates(now_ms=1031)
        self.assertEqual([str(report_path)], [item["path"] for item in candidates])
        self.store.mark_evidence_purged(
            task["taskId"], [str(report_path)], now_ms=1032
        )
        report = self.store.task_report(task["taskId"])

        attempt = report["shards"][0]["attempts"][0]
        self.assertIsNone(attempt["reportPath"])
        self.assertEqual("e" * 64, attempt["evidenceDigest"])
        self.assertEqual(1032, attempt["evidencePurgedAt"])

    def test_authenticated_http_api_survives_service_restart_and_preserves_ownership(self):
        token = "service-token-1234567890abcdef"

        def start_server():
            server = managed_execution.create_http_server(self.store, token, port=0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            return server, thread

        def request(server, method, path, body=None, authenticated=True):
            headers = {}
            data = None
            if authenticated:
                headers["Authorization"] = "Bearer " + token
            if body is not None:
                data = json.dumps(body).encode("utf-8")
                headers["Content-Type"] = "application/json"
            url = "http://127.0.0.1:%d%s" % (server.server_address[1], path)
            with urlopen(Request(url, data=data, headers=headers, method=method), timeout=3) as response:
                return response.status, json.loads(response.read())

        server, thread = start_server()
        try:
            with self.assertRaises(HTTPError) as unauthorized:
                request(server, "GET", "/v1/devices", authenticated=False)
            self.assertEqual(401, unauthorized.exception.code)
            unauthorized.exception.close()

            status, registered = request(
                server,
                "POST",
                "/v1/devices",
                {
                    "deviceId": "pixel-api",
                    "serial": "API-SERIAL",
                    "apiLevel": 35,
                    "capabilities": ["verification"],
                    "labels": {"tier": "physical"},
                },
            )
            self.assertEqual(200, status)
            self.assertEqual("pixel-api", registered["deviceId"])

            submission = {
                "plan": self.plan(),
                "matrix": self.matrix(),
                "idempotencyKey": "api-ci-1",
                "ownerToken": "api-owner-token-1234567890",
            }
            _, created = request(server, "POST", "/v1/tasks", submission)
            _, duplicate = request(server, "POST", "/v1/tasks", submission)
            self.assertEqual(created["taskId"], duplicate["taskId"])
            self.assertFalse(created["idempotent"])
            self.assertTrue(duplicate["idempotent"])

            with self.assertRaises(HTTPError) as foreign_cancel:
                request(
                    server,
                    "POST",
                    "/v1/tasks/%s/cancel" % created["taskId"],
                    {"ownerToken": "foreign-owner-1234567890"},
                )
            self.assertEqual(403, foreign_cancel.exception.code)
            foreign_cancel.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

        self.store = managed_execution.ManagedExecutionStore(self.database)
        server, thread = start_server()
        try:
            _, restored = request(server, "GET", "/v1/tasks/%s" % created["taskId"])
            self.assertEqual("queued", restored["status"])
            _, cancelled = request(
                server,
                "POST",
                "/v1/tasks/%s/cancel" % created["taskId"],
                {"ownerToken": "api-owner-token-1234567890"},
            )
            self.assertEqual("cancelled", cancelled["status"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
