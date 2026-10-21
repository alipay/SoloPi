import json
import unittest
from pathlib import Path

from solopi_harness.verification_engine import compile_verification_plan
from solopi_harness.trustbench_notes_storage import FROZEN_TASKS, V3_PLAN_FINGERPRINT


class LongBudgetTests(unittest.TestCase):
    def test_holdout_plan_is_frozen_and_not_the_model_seed(self):
        root = Path(__file__).resolve().parents[1] / 'trustbench'
        source = json.loads((root / 'notes-oracle-holdout-v1.json').read_text())
        plan = compile_verification_plan(source)
        self.assertEqual(plan, json.loads((root / 'notes-oracle-holdout-v1.plan.json').read_text()))
        task = FROZEN_TASKS[plan['planFingerprint']]
        self.assertEqual(task['sourceFingerprint'], plan['sourceFingerprint'])
        self.assertEqual('Release checklist', task['expected']['title'])
        self.assertNotEqual(task['expected'], FROZEN_TASKS[V3_PLAN_FINGERPRINT]['expected'])

    def test_separate_frozen_plan_keeps_original_task_and_step_limits(self):
        root = Path(__file__).resolve().parents[1] / 'trustbench'
        original = json.loads((root / 'agent-notes-v3.json').read_text())
        extended = json.loads((root / 'agent-notes-v3-paced30-long-v1.json').read_text())
        plan = compile_verification_plan(extended)
        self.assertEqual(plan, json.loads((root / 'agent-notes-v3-paced30-long-v1.plan.json').read_text()))
        self.assertEqual(V3_PLAN_FINGERPRINT, compile_verification_plan(original)['planFingerprint'])
        self.assertNotEqual(V3_PLAN_FINGERPRINT, plan['planFingerprint'])
        self.assertEqual(plan['sourceFingerprint'], FROZEN_TASKS[plan['planFingerprint']]['sourceFingerprint'])
        old, new = original['scenarios'][0], extended['scenarios'][0]
        self.assertEqual(old['checkpoints'], new['checkpoints'])
        self.assertEqual(old['steps'][1]['goal'], new['steps'][1]['goal'])
        budget = new['steps'][1]['budget']
        self.assertEqual(600000, budget['maxDurationMs'])
        self.assertEqual(120000, budget['idleTimeoutMs'])
        self.assertEqual(new['budget'], budget)
        for key in ('maxSteps', 'maxRepeatedActions', 'maxNoProgressSteps'):
            self.assertEqual(old['steps'][1]['budget'][key], budget[key])
