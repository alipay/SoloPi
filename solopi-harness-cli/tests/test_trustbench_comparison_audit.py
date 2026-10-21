import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from solopi_harness.trustbench_comparison_audit import audit


class ComparisonAuditTests(unittest.TestCase):
    def fixture(self, root, arm):
        root.mkdir()
        (root / 'comparison-policy.json').write_text(json.dumps({
            'arm': arm, 'modelPromptSha256': 'prompt'}))
        data = {'goal': 'test'}
        digest = hashlib.sha256(json.dumps(data, separators=(',', ':')).encode()).hexdigest()
        (root / 'model-inputs.json').write_text(json.dumps([
            {'modelInput': data, 'modelInputSha256': digest}]))

    @patch('solopi_harness.trustbench_comparison_audit.evaluate_attempt')
    def test_keeps_arms_and_no_superiority(self, evaluate):
        evaluate.side_effect = [dict(startedAt=0, finishedAt=1, planFingerprint='p',
            agentBudget={}, deviceSerial='d', apkSha256='a', outcome=outcome)
            for outcome in ['task_failed', 'passed']]
        with tempfile.TemporaryDirectory() as tmp:
            direct, harness = Path(tmp) / 'direct', Path(tmp) / 'harness'
            self.fixture(direct, 'direct')
            self.fixture(harness, 'harness')
            result = audit(direct, harness)
        self.assertEqual([r['outcome'] for r in result['attempts']], ['task_failed', 'passed'])
        self.assertTrue(result['sameInitialModelInput'])
        self.assertFalse(result['superiorityEstablished'])

    @patch('solopi_harness.trustbench_comparison_audit.evaluate_attempt', return_value={})
    def test_rejects_mislabeled_arm(self, evaluate):
        with tempfile.TemporaryDirectory() as tmp:
            direct = Path(tmp) / 'direct'
            self.fixture(direct, 'harness')
            with self.assertRaisesRegex(ValueError, 'arm mismatch'):
                audit(direct, direct)
