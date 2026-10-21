"""Independent persisted-state readback for the debuggable TrustBench Notes fixture."""

import argparse
import hashlib
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path


PACKAGE = "com.example.trustnotes"
STORE_PATH = "shared_prefs/trustbench_notes.xml"
V2_PLAN_FINGERPRINT = "c9c25fb759af01030345c2440d25540636223696c3c84c7743f2c0d4b287759e"
V2_SOURCE_FINGERPRINT = "c849d07d762c62cde17851e8c9e437c615ed142fa59344f98165c88f3794261b"
V3_PLAN_FINGERPRINT = "200b341d47940ab6f30398b0ff5f9795d312fdbe3bea89a6148b0c1a86f5c45d"
V3_SOURCE_FINGERPRINT = "486b13659458e4a89181a1272d4177c5e15a8e7f0d9db394b36c08c57ca55273"
REVISIT_PLAN_FINGERPRINT = "ac12042e7974a596b4532ba33966abb0cf0f61cfc3924e21a9291e095ebd9cea"
REVISIT_SOURCE_FINGERPRINT = "8cbfffe4348556467680083b4e6a4f36f51ac26548f2c3761d05216a46fb90c5"
REVISIT_V2_PLAN_FINGERPRINT = "d4910d8a903178528ed7bd1628a2a823deeafb72b1a3c0e5e6aab7d821435643"
REVISIT_V2_SOURCE_FINGERPRINT = "5cb1a1eeac6d1439fd57ab45e90f8fabee45bbe9f1a4d35f13ec7cf46eeef143"
FROZEN_TASKS = {
    "625ef09d0778859949c85832ef3ea6a6cd73c305d80220bf70cbce50ec096071": {
        "sourceFingerprint": "08a71caa03a4831975df14fd8a4443515c89e1037eb2566e88da2d817f5e5f81",
        "scenarioId": "create-review-note",
        "expected": {"title": "Release checklist", "body": "Verify backup before Monday"},
        "uiExpected": {"saved-title-matches": "Release checklist",
                       "saved-body-matches": "Verify backup before Monday"},
    },
    "7b9c96b7c9fbcffeba5d1c2449340f09c77cfbbbd6996e1bc03d1e6a0af6a2b6": {
        "sourceFingerprint": "fcf3153210722168873ddf74ecdbf9e4b17612b9b35a71c8fde5bf029489f708",
        "scenarioId": "create-review-note",
        "expected": {"title": "Quarterly review", "body": "Check totals before Friday"},
        "uiExpected": {"saved-title-matches": "Quarterly review",
                       "saved-body-matches": "Check totals before Friday"},
    },
    V2_PLAN_FINGERPRINT: {
        "sourceFingerprint": V2_SOURCE_FINGERPRINT,
        "scenarioId": "create-trip-note",
        "expected": {"title": "Trip checklist", "body": "Passport and charger"},
        "uiExpected": {"saved-title-matches": "Trip checklist",
                       "saved-body-matches": "Passport and charger"},
    },
    V3_PLAN_FINGERPRINT: {
        "sourceFingerprint": V3_SOURCE_FINGERPRINT,
        "scenarioId": "create-review-note",
        "expected": {"title": "Quarterly review", "body": "Check totals before Friday"},
        "uiExpected": {"saved-title-matches": "Quarterly review",
                       "saved-body-matches": "Check totals before Friday"},
    },
    REVISIT_PLAN_FINGERPRINT: {
        "sourceFingerprint": REVISIT_SOURCE_FINGERPRINT,
        "scenarioId": "revisit-budget-note",
        "expected": {"title": "Budget review", "body": "Reconcile 3 invoices"},
        "uiExpected": {"initial-title-matches": "Budget review",
                       "initial-body-matches": "Reconcile 3 invoices",
                       "list-has-one-note": "1",
                       "list-title-matches": "Budget review",
                       "reopened-title-matches": "Budget review",
                       "reopened-body-matches": "Reconcile 3 invoices"},
    },
    REVISIT_V2_PLAN_FINGERPRINT: {
        "sourceFingerprint": REVISIT_V2_SOURCE_FINGERPRINT,
        "scenarioId": "revisit-budget-note",
        "expected": {"title": "Budget review", "body": "Reconcile 3 invoices"},
        "uiExpected": {"initial-title-matches": "Budget review",
                       "initial-body-matches": "Reconcile 3 invoices",
                       "list-has-one-note": "1",
                       "reopened-title-matches": "Budget review",
                       "reopened-body-matches": "Reconcile 3 invoices"},
    },
}


def parse_preferences(raw):
    root = ET.fromstring(raw)
    if root.tag != "map":
        raise ValueError("unexpected_preferences_root")
    values = {}
    for item in root:
        if item.tag != "string" or not item.get("name"):
            raise ValueError("unexpected_preferences_entry")
        name = item.attrib["name"]
        if name in values:
            raise ValueError("duplicate_preferences_key")
        values[name] = item.text or ""
    return values


def verify_report(report, plan):
    task = FROZEN_TASKS.get(plan.get("planFingerprint"))
    if not task or plan.get("sourceFingerprint") != task["sourceFingerprint"]:
        raise ValueError("not_frozen_notes_plan")
    if report.get("status") != "passed":
        raise ValueError("ui_run_not_passed")
    if report.get("planFingerprint") != plan.get("planFingerprint"):
        raise ValueError("plan_fingerprint_mismatch")
    scenarios = report.get("scenarios", [])
    if len(scenarios) != 1 or scenarios[0].get("scenarioId") != task["scenarioId"]:
        raise ValueError("unexpected_scenario")
    scenario = scenarios[0]
    if scenario.get("status") != "passed" or scenario.get("cleanup", {}).get("status") != "not_required":
        raise ValueError("unexpected_run_or_cleanup_status")
    checks = {item.get("checkpointId"): item for item in scenario.get("checkpoints", [])}
    if (len(checks) != len(scenario.get("checkpoints", [])) or
            set(checks) != {"list-is-empty", *task["uiExpected"]} or
            any(item.get("status") != "passed" for item in checks.values())):
        raise ValueError("ui_checkpoint_not_passed")
    for checkpoint, expected in task["uiExpected"].items():
        if checks[checkpoint].get("actual") != expected:
            raise ValueError("ui_value_mismatch")
    return task["expected"]


def verify_preferences(raw, expected):
    values = parse_preferences(raw)
    if values != expected:
        raise ValueError("persisted_values_mismatch")
    return values


def adb(serial, *args):
    result = subprocess.run(["adb", "-s", serial, *args], capture_output=True, check=False, timeout=20)
    if result.returncode:
        raise RuntimeError("adb_command_failed: " + result.stderr.decode("utf-8", "replace").strip()[:180])
    return result.stdout


def collect(run_dir, serial, apk):
    report = json.loads((run_dir / "report.json").read_text())
    plan = json.loads((run_dir / "plan.json").read_text())
    expected = verify_report(report, plan)
    apk_digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    package_paths = adb(serial, "shell", "cmd", "package", "path", PACKAGE).decode().strip().splitlines()
    base_paths = [line.removeprefix("package:") for line in package_paths if line.startswith("package:") and line.endswith("base.apk")]
    if len(base_paths) != 1:
        raise ValueError("installed_apk_not_unique")
    installed_digest = adb(serial, "shell", "sha256sum", base_paths[0]).decode().split()[0]
    if installed_digest != apk_digest:
        raise ValueError("installed_apk_digest_mismatch")
    # The process is stopped before reading the on-device file, so live View state cannot satisfy this check.
    adb(serial, "shell", "am", "force-stop", PACKAGE)
    raw = adb(serial, "shell", "run-as", PACKAGE, "cat", STORE_PATH)
    values = verify_preferences(raw, expected)
    return {
        "schemaVersion": "solopi.trustbench.notes-storage/v1",
        "status": "passed",
        "runId": run_dir.name,
        "planFingerprint": plan["planFingerprint"],
        "serial": serial,
        "package": PACKAGE,
        "apkSha256": apk_digest,
        "preferencesSha256": hashlib.sha256(raw).hexdigest(),
        "observed": values,
        "readAtUtc": datetime.now(timezone.utc).isoformat(),
        "method": "adb run-as after force-stop; parsed SharedPreferences XML",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--apk", type=Path, required=True)
    args = parser.parse_args()
    receipt_path = args.run_dir / "storage-readback.json"
    if receipt_path.exists():
        print(json.dumps({"status": "failed", "reason": "receipt_already_exists", "receipt": str(receipt_path)}))
        return 1
    try:
        receipt = collect(args.run_dir, args.serial, args.apk)
    except (OSError, ValueError, RuntimeError, ET.ParseError, subprocess.TimeoutExpired) as error:
        receipt = {
            "schemaVersion": "solopi.trustbench.notes-storage/v1",
            "status": "failed",
            "runId": args.run_dir.name,
            "serial": args.serial,
            "reason": str(error),
            "readAtUtc": datetime.now(timezone.utc).isoformat(),
        }
    try:
        with receipt_path.open("x") as output:
            output.write(json.dumps(receipt, indent=2, ensure_ascii=True) + "\n")
    except FileExistsError:
        print(json.dumps({"status": "failed", "reason": "receipt_already_exists", "receipt": str(receipt_path)}))
        return 1
    print(json.dumps({"status": receipt["status"], "receipt": str(receipt_path), "reason": receipt.get("reason")}))
    return 0 if receipt["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
