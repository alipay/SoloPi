import argparse
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from solopi_harness.trustbench_perturbed_comparison import PerturbedAdapter, comparison


class PerturbationTests(unittest.TestCase):
    def test_verified_navigation_preserves_original_observation(self):
        with tempfile.TemporaryDirectory() as tmp:
            adapter = object.__new__(PerturbedAdapter)
            adapter.count = 0
            adapter.mode = 'harness'
            adapter.artifact_root = Path(tmp)
            adapter.adb = Mock()
            pkg = comparison.NOTES_PACKAGE
            adapter.adb.foreground_component.return_value = pkg + '/.MainActivity'
            adapter.adb.shell.return_value = Mock(returncode=0, stdout='<hierarchy>' + ''.join(
                '<node package="%s" resource-id="%s:id/%s" />' % (pkg, pkg, name)
                for name in ['title_input', 'body_input', 'save_button']) + '</hierarchy>')
            obs = {'observationId': 'old', 'page': {'nodeId': 'n', 'packageName': pkg,
                'resourceId': pkg + ':id/new_note_button', 'visible': True, 'isClickable': True,
                'nodeBound': {'left': 0, 'right': 100, 'top': 100, 'bottom': 200}}}
            args = argparse.Namespace(action='click', node_id='n')
            with patch.object(comparison.ComparisonAdapter, '_perform_agent_action', return_value=(
                    {'receipt': {'status': 'rejected', 'errorCode': 'stale_observation'}}, 2)) as dispatch, \
                    patch('solopi_harness.trustbench_perturbed_comparison.time.sleep'):
                adapter._perform_agent_action(args, obs)
            self.assertIs(dispatch.call_args.args[1], obs)
            record = comparison.cli.load_json_file(Path(tmp) / 'perturbation.json')
            self.assertTrue(record['injectionVerified'])
            self.assertTrue(record['staleActionRejected'])

    def test_no_second_injection(self):
        adapter = object.__new__(PerturbedAdapter)
        adapter.count = 1
        adapter.adb = Mock()
        with patch.object(comparison.ComparisonAdapter, '_perform_agent_action', return_value=({}, 0)):
            adapter._perform_agent_action(None, {})
        adapter.adb.shell.assert_not_called()
