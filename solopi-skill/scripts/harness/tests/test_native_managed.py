import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import solopi_ai as cli, verification_engine
from test_native_runtime import FakeDriver, requirement


class NativeManagedTests(unittest.TestCase):
    def setup_task(self, root):
        database = root / "managed.sqlite"
        plan_path = root / "plan.json"
        matrix_path = root / "matrix.json"
        plan = verification_engine.compile_verification_plan(requirement())
        cli.write_json_file(plan_path, plan)
        cli.write_json_file(matrix_path, [{"id": "ios", "selector": {"platform": "ios", "capabilities": ["verification"]}}])
        store = cli.managed_execution.ManagedExecutionStore(database)
        store.register_device("iphone", "fake-1", "ios", 27, ["verification"], {"native-kind": "simulator", "wda-port": "8100"}, "healthy")
        submit = cli.build_parser().parse_args(["managed-submit", "--database", str(database), "--plan", str(plan_path),
                                              "--matrix", str(matrix_path), "--idempotency-key", "native-test"])
        task, _ = cli.command_managed_submit(submit, None)
        args = cli.build_parser().parse_args(["managed-worker-once", "--database", str(database), "--worker-id", "worker", "--artifacts-root", str(root / "runs")])
        return store, task, args

    def test_native_worker_uses_native_driver_and_never_constructs_adb(self):
        with tempfile.TemporaryDirectory() as directory:
            store, task, args = self.setup_task(Path(directory))
            driver = FakeDriver()
            driver.close = mock.Mock()
            with mock.patch.object(cli.native_runtime, "create_driver", return_value=driver), \
                 mock.patch.object(cli, "AdbClient", side_effect=AssertionError("native must not touch ADB")):
                payload, code = cli.command_managed_worker_once(args, None)
            self.assertEqual(0, code)
            self.assertEqual("passed", payload["result"]["taskStatus"])
            self.assertEqual(1, driver.actions)
            driver.close.assert_called_once()

    def test_lost_lease_blocks_next_native_action(self):
        with tempfile.TemporaryDirectory() as directory:
            store, task, args = self.setup_task(Path(directory))
            assignment = store.claim_next("worker")
            driver = FakeDriver()
            driver.close = mock.Mock()
            with mock.patch.object(cli.native_runtime, "create_driver", return_value=driver), \
                 mock.patch.object(store, "heartbeat", side_effect=cli.managed_execution.ManagedExecutionError("stale_assignment", "lost generation")):
                with self.assertRaises(cli.CliError) as caught:
                    cli.run_managed_assignment(args, assignment, store)
            self.assertEqual("stale_assignment", caught.exception.details["errorCode"])
            self.assertEqual(0, driver.actions)

    def test_submit_rejects_cross_platform_matrix(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store, task, args = self.setup_task(root)
            cli.write_json_file(root / "wrong.json", [{"id": "android", "selector": {"platform": "android"}}])
            args = cli.build_parser().parse_args(["managed-submit", "--database", str(root / "managed.sqlite"), "--plan", str(root / "plan.json"),
                                                 "--matrix", str(root / "wrong.json"), "--idempotency-key", "wrong-platform"])
            with self.assertRaises(cli.CliError):
                cli.command_managed_submit(args, None)


if __name__ == "__main__":
    unittest.main()
