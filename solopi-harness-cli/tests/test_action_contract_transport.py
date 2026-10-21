import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from solopi_harness import solopi_ai as c


class ContractTransportTests(unittest.TestCase):
    def test_session_freezes_contract_and_rejects_old_device_before_start(self):
        for supported in (False, True):
            with self.subTest(supported=supported), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / 'contract.json'
                path.write_text(json.dumps({'version': 1, 'bindings': []}))
                args = c.build_parser().parse_args(['agent-session-start', '--agent-action-contract', str(path)])
                session = mock.MagicMock()
                session.__enter__.return_value = session
                session.agent.side_effect = [
                    {'success': True, 'actionContractVersion': 1} if supported else {},
                    {'success': True, 'session': {'sessionId': 's', 'state': 'active'},
                     'observation': {'observationId': 'o'}}]
                with mock.patch.object(c, 'session_from_args', return_value=session), \
                     mock.patch.object(c, 'invoke_agent_mutation') as mutation, \
                     mock.patch.object(c, 'best_effort_agent_cancel'):
                    if supported:
                        _, code = c.command_agent_session_start(args, mock.Mock())
                        self.assertEqual(code, 0)
                        sent = mutation.call_args.args[1]['actionContractJson']
                        path.write_text('{}')  # Edits after start cannot mutate the device copy.
                        self.assertEqual(json.loads(sent), {'version': 1, 'bindings': []})
                    else:
                        with self.assertRaises(c.CliError):
                            c.command_agent_session_start(args, mock.Mock())
                        mutation.assert_not_called()

    def test_unreadable_or_invalid_contract_never_opens_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'contract.json'
            for value in (None, 'bad', '[]', '{' + ' ' * 8192 + '}'):
                if value is not None:
                    path.write_text(value)
                args = c.build_parser().parse_args(['agent-session-start', '--agent-action-contract', str(path)])
                with mock.patch.object(c, 'session_from_args') as session:
                    with self.assertRaises(c.CliError):
                        c.command_agent_session_start(args, mock.Mock())
                    session.assert_not_called()
