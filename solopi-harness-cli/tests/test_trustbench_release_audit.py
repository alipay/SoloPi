import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from solopi_harness import trustbench_release_audit as audit


class ReleaseAuditTests(unittest.TestCase):
    def fixture(self, root):
        (root / 'ledger.json').write_text('{}')
        probes = []
        for kind in ('positive', 'false_done'):
            path = root / kind
            path.mkdir()
            report = {'scenarios': [{'failure': {'category': 'oracle_mismatch'},
                'checkpoints': [
                    {'checkpointId': 'list-is-empty', 'status': 'passed'},
                    {'checkpointId': 'saved-title-matches', 'status': 'failed'},
                    {'checkpointId': 'saved-body-matches', 'status': 'failed'}]}]}
            (path / 'report.json').write_text(json.dumps(report))
            probes.append({'kind': kind, 'runDir': str(path)})
        index = root / 'index.json'
        index.write_text(json.dumps({'manifests': ['ledger.json'],
                                    'currentManifest': 'ledger.json', 'oracleProbes': probes}))
        rows = [{'runId': track, 'track': track, 'outcome': 'passed',
                 'planFingerprint': 'plan', 'deviceSerial': 'device',
                 'apkSha256': 'apk', 'agentBudget': {'maxSteps': 8}}
                for track in ('control', 'model')]
        return index, {'attempts': rows}

    def probe(self, path, track):
        return {'outcome': 'passed' if path.name == 'positive' else 'task_failed',
                'agentDone': True, 'actions': 0, 'modelDecisionCount': 0}

    def check(self, mutation=None, expected=None):
        with tempfile.TemporaryDirectory() as directory:
            index, group = self.fixture(Path(directory))
            if mutation:
                mutation(index, group)
            with patch.object(audit, 'evaluate_manifest', return_value=group), \
                    patch.object(audit, 'evaluate_attempt', side_effect=self.probe):
                if expected:
                    with self.assertRaisesRegex(ValueError, expected):
                        audit.audit(index)
                else:
                    result = audit.audit(index)
                    self.assertTrue(result['pilotClosurePassed'])
                    self.assertFalse(result['eligibleForModelRanking'])

    def test_complete_contract(self):
        self.check()

    def test_different_device_is_rejected(self):
        self.check(lambda _, g: g['attempts'][1].update(deviceSerial='other'), 'conditions differ')

    def test_missing_passing_model_is_rejected(self):
        self.check(lambda _, g: g['attempts'][1].update(outcome='provider_not_tested'), 'incomplete')

    def test_duplicate_attempt_is_rejected(self):
        self.check(lambda _, g: g['attempts'][1].update(runId='control'), 'repeated')

    def test_false_done_setup_failure_is_not_a_valid_probe(self):
        def mutate(index, _):
            path = index.parent / 'false_done' / 'report.json'
            report = json.loads(path.read_text())
            report['scenarios'][0]['checkpoints'][0]['status'] = 'failed'
            path.write_text(json.dumps(report))
        self.check(mutate, 'contract')
