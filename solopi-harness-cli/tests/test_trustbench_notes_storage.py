import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from solopi_harness.trustbench_notes_storage import (
    V2_PLAN_FINGERPRINT,
    V2_SOURCE_FINGERPRINT,
    V3_PLAN_FINGERPRINT,
    V3_SOURCE_FINGERPRINT,
    REVISIT_PLAN_FINGERPRINT,
    REVISIT_SOURCE_FINGERPRINT,
    REVISIT_V2_PLAN_FINGERPRINT,
    REVISIT_V2_SOURCE_FINGERPRINT,
    parse_preferences,
    verify_preferences,
    verify_report,
    main,
)


class NotesStorageTests(unittest.TestCase):
    v2_expected = {"title": "Trip checklist", "body": "Passport and charger"}
    v3_expected = {"title": "Quarterly review", "body": "Check totals before Friday"}

    def test_preferences_exact_match(self):
        raw = b'<map><string name="title">Trip checklist</string><string name="body">Passport and charger</string></map>'
        self.assertEqual(verify_preferences(raw, self.v2_expected)["title"], "Trip checklist")

    def test_missing_or_wrong_data_fails_closed(self):
        for raw in (
            b'<map><string name="title">Trip checklist</string></map>',
            b'<map><string name="title">Wrong</string><string name="body">Passport and charger</string></map>',
            b'<map><string name="title">Trip checklist</string><string name="title">Trip checklist</string></map>',
            b'<bad></bad>',
        ):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                verify_preferences(raw, self.v2_expected)

    def test_xml_escaping_is_parsed(self):
        self.assertEqual(parse_preferences(b'<map><string name="body">A &amp; B</string></map>')["body"], "A & B")

    def test_ui_pass_does_not_override_storage_failure(self):
        report = {
            "status": "passed", "planFingerprint": V2_PLAN_FINGERPRINT, "scenarios": [{
                "scenarioId": "create-trip-note", "status": "passed", "cleanup": {"status": "not_required"},
                "checkpoints": [
                    {"checkpointId": "list-is-empty", "status": "passed"},
                    {"checkpointId": "saved-title-matches", "status": "passed", "actual": "Trip checklist"},
                    {"checkpointId": "saved-body-matches", "status": "passed", "actual": "Passport and charger"},
                ],
            }],
        }
        plan = {"planFingerprint": V2_PLAN_FINGERPRINT, "sourceFingerprint": V2_SOURCE_FINGERPRINT}
        self.assertEqual(verify_report(report, plan), self.v2_expected)
        with self.assertRaisesRegex(ValueError, "persisted_values_mismatch"):
            verify_preferences(b'<map><string name="title">Trip checklist</string></map>', self.v2_expected)
        with self.assertRaisesRegex(ValueError, "not_frozen_notes_plan"):
            verify_report(report, {"planFingerprint": "other", "sourceFingerprint": V2_SOURCE_FINGERPRINT})

    def test_alternate_seed_rejects_old_stored_values(self):
        report = {
            "status": "passed", "planFingerprint": V3_PLAN_FINGERPRINT, "scenarios": [{
                "scenarioId": "create-review-note", "status": "passed", "cleanup": {"status": "not_required"},
                "checkpoints": [
                    {"checkpointId": "list-is-empty", "status": "passed"},
                    {"checkpointId": "saved-title-matches", "status": "passed", "actual": "Quarterly review"},
                    {"checkpointId": "saved-body-matches", "status": "passed", "actual": "Check totals before Friday"},
                ],
            }],
        }
        plan = {"planFingerprint": V3_PLAN_FINGERPRINT, "sourceFingerprint": V3_SOURCE_FINGERPRINT}
        self.assertEqual(verify_report(report, plan), self.v3_expected)
        stale = b'<map><string name="title">Trip checklist</string><string name="body">Passport and charger</string></map>'
        with self.assertRaisesRegex(ValueError, "persisted_values_mismatch"):
            verify_preferences(stale, self.v3_expected)

    def test_revisit_requires_list_and_reopened_checkpoints(self):
        expected = {"title": "Budget review", "body": "Reconcile 3 invoices"}
        checkpoints = [
            {"checkpointId": checkpoint, "status": "passed", "actual": actual}
            for checkpoint, actual in (
                ("list-is-empty", None), ("initial-title-matches", expected["title"]),
                ("initial-body-matches", expected["body"]),
                ("list-has-one-note", "1"), ("list-title-matches", expected["title"]),
                ("reopened-title-matches", expected["title"]),
                ("reopened-body-matches", expected["body"]),
            )
        ]
        report = {"status": "passed", "planFingerprint": REVISIT_PLAN_FINGERPRINT,
                  "scenarios": [{"scenarioId": "revisit-budget-note", "status": "passed",
                                 "cleanup": {"status": "not_required"}, "checkpoints": checkpoints}]}
        plan = {"planFingerprint": REVISIT_PLAN_FINGERPRINT,
                "sourceFingerprint": REVISIT_SOURCE_FINGERPRINT}
        self.assertEqual(expected, verify_report(report, plan))
        checkpoints[3]["actual"] = "0"
        with self.assertRaisesRegex(ValueError, "ui_value_mismatch"):
            verify_report(report, plan)

        checkpoints[3]["actual"] = "1"
        checkpoints.pop(4)
        report["planFingerprint"] = REVISIT_V2_PLAN_FINGERPRINT
        plan = {"planFingerprint": REVISIT_V2_PLAN_FINGERPRINT,
                "sourceFingerprint": REVISIT_V2_SOURCE_FINGERPRINT}
        self.assertEqual(expected, verify_report(report, plan))
        with self.assertRaisesRegex(ValueError, "persisted_values_mismatch"):
            verify_preferences(
                b'<map><string name="title">Quarterly review</string>'
                b'<string name="body">Check totals before Friday</string></map>', expected)

    def test_existing_receipt_is_not_overwritten(self):
        with TemporaryDirectory() as directory:
            receipt = Path(directory) / "storage-readback.json"
            receipt.write_text("original")
            with patch("sys.argv", ["storage", "--run-dir", directory, "--serial", "device", "--apk", "missing.apk"]):
                self.assertEqual(main(), 1)
            self.assertEqual(receipt.read_text(), "original")


if __name__ == "__main__":
    unittest.main()
