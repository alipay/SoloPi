import argparse
import copy
import unittest
from unittest.mock import Mock, patch

from solopi_harness import trustbench_direct_comparison as comparison


class DirectComparisonTests(unittest.TestCase):
    def observation(self):
        return {'signature': 'before', 'page': {
            'nodeId': 'node-1', 'packageName': comparison.NOTES_PACKAGE,
            'resourceId': comparison.NOTES_PACKAGE + ':id/title_input',
            'visible': True, 'isEditable': True, 'isClickable': True,
            'nodeBound': {'left': 0, 'right': 100, 'top': 50, 'bottom': 100}}}

    def adapter(self):
        adapter = object.__new__(comparison.ComparisonAdapter)
        adapter.mode = 'direct'
        adapter.args = Mock()
        adapter.adb = Mock()
        adapter.adb.foreground_component.return_value = comparison.NOTES_PACKAGE + '/.MainActivity'
        adapter.adb.shell.return_value.returncode = 0
        adapter.started = adapter.last_action = comparison.time.monotonic()
        adapter.count = adapter.repeats = adapter.no_progress = 0
        adapter.previous_action = None
        adapter.budget = {'maxSteps': 8, 'maxDurationMs': 600000,
                          'idleTimeoutMs': 120000, 'maxRepeatedActions': 3,
                          'maxNoProgressSteps': 2}
        return adapter

    def arguments(self):
        return argparse.Namespace(action='input', node_id='node-1', text='Quarterly review',
                                  session_id='s', owner_token='private', step_id='step-1',
                                  observation_id='o')

    def test_direct_input_is_host_record_not_guard_receipt(self):
        adapter = self.adapter()
        observation = self.observation()
        before = copy.deepcopy(observation)
        with patch.object(comparison.cli, 'session_from_args') as factory, \
                patch.object(comparison.time, 'sleep'):
            factory.return_value.__enter__.return_value.agent.return_value = {
                'success': True, 'observation': {'signature': 'after'}}
            result, code = adapter._perform_agent_action(self.arguments(), observation)
        self.assertEqual(0, code)
        self.assertEqual('host_direct_adb', result['receipt']['source'])
        self.assertFalse(result['receipt']['guardChecked'])
        self.assertEqual(before, observation)
        self.assertEqual(['input', 'text', 'Quarterly%sreview'], adapter.adb.shell.call_args.args[0])
        self.assertFalse(factory.call_args.kwargs['launch_app'])

    def test_refuses_other_app_before_any_action(self):
        adapter = self.adapter()
        adapter.adb.foreground_component.return_value = 'com.android.settings/.Settings'
        with self.assertRaises(comparison.cli.CliError):
            adapter._perform_agent_action(self.arguments(), self.observation())
        adapter.adb.shell.assert_not_called()

    def test_shell_syntax_and_unicode_are_not_admitted(self):
        for text in ('a;id', '$(id)', 'a%sb', '中文', '', 'a\nb'):
            with self.subTest(text=text), self.assertRaises(comparison.cli.CliError):
                comparison.input_argument(text)

    def test_reset_and_foreign_nodes_are_not_admitted(self):
        for resource in ('reset_button', 'android:id/title'):
            observation = self.observation()
            observation['page']['resourceId'] = resource
            with self.assertRaises(comparison.cli.CliError):
                comparison.observed_target(observation, 'node-1', 'input')

    def test_step_budget_prevents_dispatch(self):
        adapter = self.adapter()
        adapter.count = 8
        with self.assertRaises(comparison.cli.CliError):
            adapter._perform_agent_action(self.arguments(), self.observation())
        adapter.adb.shell.assert_not_called()

    def test_guarded_arm_keeps_existing_guard(self):
        adapter = self.adapter()
        adapter.mode = 'harness'
        with patch.object(comparison.cli, 'command_agent_act', return_value=(
                {'receipt': {'status': 'rejected', 'errorCode': 'stale_observation'}}, 2)) as act:
            result, code = adapter._perform_agent_action(self.arguments(), self.observation())
        self.assertEqual(2, code)
        self.assertEqual('stale_observation', result['receipt']['errorCode'])
        self.assertTrue(act.call_args.kwargs['reuse_control_service'])
        adapter.adb.shell.assert_not_called()
