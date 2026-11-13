import tempfile
import unittest
import subprocess
from types import SimpleNamespace
from pathlib import Path
from unittest import mock

from solopi_harness import desktop_control, virtual_desktop


class FixtureReplyTransportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        config = {'deviceId': 'device', 'appId': 'com.solopi.fastpath.replyfixture', 'controlPackage': 'com.example.test', 'controlPort': 23343}
        self.owner = virtual_desktop.VirtualDesktopSession(config, Path(self.tmp.name) / 'owner', desktop_control.cli_args)
        self.owner.session_id, self.owner.owner_token = 'session', 'a' * 64
        self.owner.adb.device = {'serial': 'device', 'state': 'device'}
        self.owner.current = {'observationId': 'observation'}
        self.owner._write_report = mock.Mock()
        self.owner._frame = mock.Mock(return_value={'observationId': 'next', 'nodes': []})
        self.payload = {'observationId': 'observation', 'contactId': 'friend-1', 'messageId': 'm1', 'reply': 'test reply'}

    def test_input_binds_owner_and_consumes_observation(self):
        transport = mock.MagicMock()
        transport.__enter__.return_value.agent.side_effect = lambda kind, args, **kwargs: {
            'success': True, 'receipt': {'stepId': args['stepId'], 'status': 'succeeded',
                                         'settledObservation': {'observationId': 'next'}}}
        with mock.patch.object(virtual_desktop.solopi_ai, 'session_from_args', return_value=transport), \
             mock.patch.object(virtual_desktop, '_write_fixture_pipe', return_value=True) as invoke:
            result = self.owner.fixture_reply(self.payload)
        frame = invoke.call_args.args[1]
        self.assertTrue(frame.startswith(b'SPF1\x00'))
        self.assertIn(b'test reply', frame)
        self.assertIn(b'a' * 64, frame)
        self.assertEqual(result['receipt']['status'], 'succeeded')
        self.assertFalse(self.owner.action_outcome_unknown)
        self.assertNotIn('test reply', str(self.owner.events))

    def test_only_fixture_and_current_observation_can_dispatch(self):
        self.owner.config['appId'] = 'com.tencent.mm'
        with self.assertRaisesRegex(virtual_desktop.Error, 'fixture_unavailable'):
            self.owner.fixture_reply(self.payload)
        self.owner.config['appId'] = 'com.solopi.fastpath.replyfixture'
        self.owner.current = {'observationId': 'new'}
        with self.assertRaisesRegex(virtual_desktop.Error, 'stale_observation'):
            self.owner.fixture_reply(self.payload)

    def test_lost_receipt_blocks_retries(self):
        transport = mock.MagicMock()
        transport.__enter__.return_value.agent.side_effect = OSError('transport unavailable')
        with mock.patch.object(virtual_desktop.solopi_ai, 'session_from_args', return_value=transport), \
             mock.patch.object(virtual_desktop, '_write_fixture_pipe'):
            with self.assertRaises(OSError): self.owner.fixture_reply(self.payload, send=True)
        self.assertTrue(self.owner.action_outcome_unknown)
        with self.assertRaisesRegex(virtual_desktop.Error, 'virtual_action_outcome_unconfirmed'):
            self.owner.fixture_reply(self.payload, send=True)

    def test_submitted_fixture_action_can_write_the_real_report_before_dispatch(self):
        self.owner._write_report = virtual_desktop.VirtualDesktopSession._write_report.__get__(self.owner)
        transport = mock.MagicMock()
        transport.__enter__.return_value.agent.side_effect = OSError('transport unavailable')
        with mock.patch.object(virtual_desktop.solopi_ai, 'session_from_args', return_value=transport), \
             mock.patch.object(virtual_desktop, '_write_fixture_pipe') as invoke:
            with self.assertRaises(OSError): self.owner.fixture_reply(self.payload)
        self.assertEqual(invoke.call_count, 1)
        report = (self.owner.root / 'report.html').read_text(encoding='utf-8')
        self.assertIn('fixture-input', report)
        self.assertNotIn('test reply', report)

    def test_pipe_sends_frame_only_through_no_tty_stdin(self):
        frame = virtual_desktop._fixture_pipe_frame({'sessionId':'session', 'ownerToken':'secret-token',
            'stepId':'step', **self.payload}, True)
        with mock.patch.object(virtual_desktop.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            self.assertTrue(virtual_desktop._write_fixture_pipe(self.owner.adb, frame))
        command = run.call_args.args[0]
        self.assertIn('-T', command)
        self.assertEqual(command[-1], 'content://com.example.test.fixtureReplyPipe/write')
        self.assertNotIn('test reply', str(command))
        self.assertNotIn('secret-token', str(command))
        self.assertEqual(run.call_args.kwargs['input'], frame)
        self.assertEqual(run.call_args.kwargs['stdout'], subprocess.DEVNULL)
        self.assertEqual(run.call_args.kwargs['stderr'], subprocess.DEVNULL)
        self.assertEqual(frame[:5], b'SPF1\x01')

    def test_failed_or_timed_out_pipe_write_still_queries_receipt_once_without_resend(self):
        for failure in (SimpleNamespace(returncode=1), subprocess.TimeoutExpired('adb', 15)):
            with self.subTest(failure=type(failure)):
                self.owner.current = {'observationId':'observation'}
                self.owner.action_outcome_unknown = False
                transport = mock.MagicMock()
                transport.__enter__.return_value.agent.side_effect = lambda kind, args, **kwargs: {
                    'success': True, 'receipt': {'stepId':args['stepId'], 'status':'succeeded',
                                                 'settledObservation':{'observationId':'next'}}}
                with mock.patch.object(virtual_desktop.solopi_ai, 'session_from_args', return_value=transport), \
                     mock.patch.object(virtual_desktop.subprocess, 'run', side_effect=[failure]) as run:
                    self.assertEqual(self.owner.fixture_reply(self.payload)['receipt']['status'], 'succeeded')
                self.assertEqual(run.call_count, 1)
                self.assertEqual(transport.__enter__.return_value.agent.call_count, 1)

    def test_rejects_invalid_or_oversized_frame_before_dispatch(self):
        for reply in ('', '\0', 'x' * 8001, '\ud800'):
            with self.subTest(reply=repr(reply[:10])):
                params = {'sessionId':'session', 'ownerToken':'token', 'stepId':'step', **self.payload, 'reply':reply}
                with self.assertRaisesRegex(virtual_desktop.Error, 'invalid_fixture_reply'):
                    virtual_desktop._fixture_pipe_frame(params, False)

    def test_missing_receipt_after_failed_write_leaves_outcome_unknown(self):
        transport = mock.MagicMock()
        transport.__enter__.return_value.agent.return_value = {'errorCode':'receipt_not_found'}
        with mock.patch.object(virtual_desktop.solopi_ai, 'session_from_args', return_value=transport), \
             mock.patch.object(virtual_desktop, '_write_fixture_pipe', return_value=False) as write, \
             mock.patch.object(virtual_desktop.time, 'monotonic', side_effect=[0, 0, 61]), \
             mock.patch.object(virtual_desktop.time, 'sleep'):
            with self.assertRaisesRegex(virtual_desktop.Error, 'virtual_action_outcome_unconfirmed'):
                self.owner.fixture_reply(self.payload, send=True)
        self.assertEqual(write.call_count, 1)
        self.assertTrue(self.owner.action_outcome_unknown)
        with self.assertRaisesRegex(virtual_desktop.Error, 'virtual_action_outcome_unconfirmed'):
            self.owner.fixture_reply(self.payload, send=True)
        self.assertEqual(write.call_count, 1)

    def test_bound_pre_dispatch_rejection_stops_without_wait_or_resend(self):
        transport = mock.MagicMock()
        transport.__enter__.return_value.agent.side_effect = lambda kind, args, **kwargs: {
            'success': True, 'receipt': {'stepId':args['stepId'], 'observationId':'observation',
                'status':'rejected', 'errorCode':'fixture_pre_dispatch_rejected'}}
        with mock.patch.object(virtual_desktop.solopi_ai, 'session_from_args', return_value=transport), \
             mock.patch.object(virtual_desktop, '_write_fixture_pipe', return_value=True) as write, \
             mock.patch.object(virtual_desktop.time, 'sleep') as sleep:
            with self.assertRaisesRegex(virtual_desktop.Error, 'fixture_pre_dispatch_rejected'):
                self.owner.fixture_reply(self.payload)
        self.assertEqual(write.call_count, 1)
        sleep.assert_not_called()
        self.assertTrue(self.owner.action_outcome_unknown)

    def test_mismatched_rejection_remains_unconfirmed(self):
        transport = mock.MagicMock()
        transport.__enter__.return_value.agent.side_effect = lambda kind, args, **kwargs: {
            'success': True, 'receipt': {'stepId':args['stepId'], 'observationId':'other',
                'status':'rejected', 'errorCode':'fixture_pre_dispatch_rejected'}}
        with mock.patch.object(virtual_desktop.solopi_ai, 'session_from_args', return_value=transport), \
             mock.patch.object(virtual_desktop, '_write_fixture_pipe', return_value=True):
            with self.assertRaisesRegex(virtual_desktop.Error, 'virtual_action_outcome_unconfirmed'):
                self.owner.fixture_reply(self.payload)
        self.assertTrue(self.owner.action_outcome_unknown)
        with self.assertRaisesRegex(virtual_desktop.Error, 'virtual_action_outcome_unconfirmed'):
            self.owner.fixture_reply(self.payload, send=True)


if __name__ == '__main__': unittest.main()
