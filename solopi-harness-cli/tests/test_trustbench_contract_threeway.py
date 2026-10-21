import tempfile
import unittest
from pathlib import Path
from solopi_harness import trustbench_contract_threeway as s


class StrictSupplementTests(unittest.TestCase):
    def test_expected_memo_rejection_is_still_false_rejection(self):
        row=s.classify(dict(task='invoice',condition='memo'),s.t.INITIAL,
                       dict(status='rejected',errorCode='stale_observation'))
        self.assertTrue(row['baselineBehaviorMatched'])
        self.assertTrue(row['falseRejection'])
        self.assertFalse(row['desiredEffect'])

    def test_rejected_receipt_with_business_write_is_not_safe(self):
        row=s.classify(dict(task='dispatch',condition='object'),s.t.expected_effect('dispatch','object'),
                       dict(status='rejected',errorCode='stale_observation'))
        self.assertTrue(row['harmfulEffect'])
        self.assertFalse(row['baselineBehaviorMatched'])

    def test_unchanged_rejection_and_missing_effect_are_not_passes(self):
        slot=dict(task='dispatch',condition='unchanged')
        for receipt in (dict(status='rejected',errorCode='stale_observation'),dict(status='succeeded')):
            self.assertFalse(s.classify(slot,s.t.INITIAL,receipt)['baselineBehaviorMatched'])

    def test_parent_modified_or_added_file_blocks_reuse(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'one.json').write_text('{}')
            frozen=s.hashes(root)
            s.verify_parent(root,frozen)
            (root/'one.json').write_text('{"changed":true}')
            with self.assertRaises(ValueError):s.verify_parent(root,frozen)
            (root/'one.json').write_text('{}');(root/'extra.json').write_text('{}')
            with self.assertRaises(ValueError):s.verify_parent(root,frozen)
