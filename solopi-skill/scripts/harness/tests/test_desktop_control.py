import copy
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import desktop_control as desktop
from solopi_harness import verification_engine
from solopi_harness import virtual_desktop
import hashlib


def png(width=1, height=1):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress((b'\x00' + b'\x00\x00\x00' * width) * height)) + chunk(b'IEND', b''))


def judgment_observation(text='已支付', visible=True, overlays=()):
    bounds = {'left': 0, 'top': 0, 'right': 100, 'bottom': 100}
    return {'observationId': 'obs-1', 'screenMode': 'virtual', 'displayId': 5, 'windowId': 7, 'screenWidth': 100, 'screenHeight': 100,
            'windows': [{'id': 7, 'layer': 1, 'bounds': bounds}, *overlays],
            'page': {'packageName': 'com.example.demo', 'children': [
                {'resourceId': 'status', 'text': text, 'packageName': 'com.example.demo',
                 'isVisibleToUser': visible, 'isPassword': False,
                 'nodeBound': {'left': 10, 'top': 10, 'right': 40, 'bottom': 40}, 'children': []}]}}


def bind_judgment_evidence(owner, observation):
    owner.current = observation; owner.display_id = observation['displayId']
    (owner.root / 'frame.png').write_bytes(png(100, 100))
    observation_raw = json.dumps(observation).encode('utf-8')
    (owner.root / 'observation.json').write_bytes(observation_raw)
    owner.evidence = [{'observationId': observation['observationId'], 'observation': 'observation.json',
                       'observationSha256': hashlib.sha256(observation_raw).hexdigest(),
                       'screenshot': 'frame.png', 'sha256': hashlib.sha256(png(100, 100)).hexdigest()}]


class Driver:
    platform = 'ios'
    device_id = 'sim-test'
    supported_actions = frozenset({'click', 'input', 'back', 'scroll', 'wait'})

    def __init__(self):
        self.count, self.generation, self.closed = 0, 0, False
        self.replace = False
        self.fail_after_send = False

    def health(self): return {'ready': True}
    def launch(self, app_id): self.app_id = app_id
    def close(self): self.closed = True
    def screenshot(self): return png()
    def observe(self):
        self.generation += 1
        return {'platform': self.platform, 'deviceId': self.device_id, 'appId': self.app_id,
                'windowId': 'main', 'observationId': 'obs-' + str(self.generation),
                'page': {'children': [
                    {'accessibilityId': 'increment', 'id': 'replaced' if self.replace else 'button',
                     'visible': True, 'hittable': True, 'text': 'Increment', 'bounds': [0, 0, 10, 10]},
                    {'accessibilityId': 'value', 'visible': True, 'hittable': False, 'text': str(self.count)},
                ]}}
    def perform(self, action, target):
        self.count += 1
        if self.fail_after_send: raise OSError('lost receipt')
        return {'state': 'succeeded', 'deviceId': self.device_id}


class DesktopControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.control = desktop.DesktopControl(self.temp.name)
        self.driver = Driver()
        patch = mock.patch.object(desktop.native_runtime, 'create_driver', return_value=self.driver)
        patch.start(); self.addCleanup(patch.stop)
        self.addCleanup(self.control.close)
        self.config = {'platform': 'ios', 'deviceId': 'sim-test', 'deviceKind': 'simulator', 'appId': 'org.example.Counter'}

    def click(self, frame):
        handle = next(n['handle'] for n in frame['elements'] if n['selector'] == {'accessibilityId': 'increment'})
        return self.control.command({'type': 'act', 'action': 'click', 'handle': handle, 'observationId': frame['observationId']})

    def test_stdio_failed_start_reports_confirmed_cleanup_when_no_owner_was_created(self):
        request = json.dumps({'id':'test','operation':'virtual_start','payload':{}}) + '\n'
        result = subprocess.run([sys.executable,'-m','solopi_harness.desktop_control','--artifacts',self.temp.name],
                                input=request,text=True,capture_output=True,check=True)
        response = json.loads(result.stdout)
        self.assertFalse(response['success'])
        self.assertTrue(response['cleanupConfirmed'])
        self.assertNotIn('cleanupPending',response)

    def test_virtual_recovery_only_cancels_owned_session_and_confirms_release(self):
        config = {'platform': 'android', 'deviceId': 'device', 'deviceKind': 'physical', 'appId': 'com.example.demo'}
        owner = 'a' * 64
        active = {'sessionId':'session-1', 'screenMode':'virtual', 'targetPackage':config['appId'],
                  'state':'active', 'leaseHeld':True, 'cleanupPending':False}
        terminal = {**active, 'state':'cancelled', 'leaseHeld':False}
        session = mock.MagicMock()
        session.__enter__.return_value.agent.return_value = {'success':True, 'session':active}
        adb = mock.Mock()
        with mock.patch.object(desktop.solopi_ai, 'AdbClient', return_value=adb), \
             mock.patch.object(desktop.solopi_ai, 'session_from_args', return_value=session), \
             mock.patch.object(desktop.solopi_ai, 'command_agent_mutation', return_value=({'success':True,'session':terminal}, 0)) as mutate, \
             mock.patch.object(desktop.solopi_ai, 'command_agent_query') as query:
            result = self.control.virtual_recover({'config':config,'ownerToken':owner})
        self.assertEqual({'state':'closed','cleanupConfirmed':True,'recovered':True}, result)
        self.assertEqual('cancel', mutate.call_args.args[2])
        query.assert_not_called()
        session.__enter__.return_value.agent.assert_called_once_with('start-status', {'ownerToken':owner})

    def test_virtual_recovery_refuses_wrong_target_or_unconfirmed_release(self):
        config = {'platform':'android','deviceId':'device','deviceKind':'physical','appId':'com.example.demo'}
        owner = 'a' * 64
        session = mock.MagicMock()
        active = {'sessionId':'session-1','screenMode':'virtual','targetPackage':'other.app',
                  'state':'active','leaseHeld':True,'cleanupPending':False}
        session.__enter__.return_value.agent.return_value = {'success':True,'session':active}
        with mock.patch.object(desktop.solopi_ai, 'AdbClient'), \
             mock.patch.object(desktop.solopi_ai, 'session_from_args', return_value=session), \
             mock.patch.object(desktop.solopi_ai, 'command_agent_mutation') as mutate:
            with self.assertRaisesRegex(desktop.Error, 'virtual_cleanup_unconfirmed'):
                self.control.virtual_recover({'config':config,'ownerToken':owner})
            mutate.assert_not_called()
            active['targetPackage'] = config['appId']
            mutate.return_value = ({'success':True,'session':{**active,'state':'cancelled','leaseHeld':True}}, 0)
            with self.assertRaisesRegex(desktop.Error, 'virtual_cleanup_unconfirmed'):
                self.control.virtual_recover({'config':config,'ownerToken':owner})
            mutate.reset_mock()
            active['state'] = 'unknown'
            with self.assertRaisesRegex(desktop.Error, 'virtual_cleanup_unconfirmed'):
                self.control.virtual_recover({'config':config,'ownerToken':owner})
            mutate.assert_not_called()
            session.__enter__.return_value.agent.return_value = None
            with self.assertRaisesRegex(desktop.Error, 'virtual_cleanup_unconfirmed'):
                self.control.virtual_recover({'config':config,'ownerToken':owner})

    def test_virtual_recovery_queries_terminal_and_retries_only_pending_cleanup(self):
        config = {'platform':'android','deviceId':'device','deviceKind':'physical','appId':'com.example.demo'}
        state = {'sessionId':'session-1','screenMode':'virtual','targetPackage':config['appId'],
                 'state':'expired','leaseHeld':False,'cleanupPending':False}
        session = mock.MagicMock()
        session.__enter__.return_value.agent.return_value = {'success':True,'session':state}
        with mock.patch.object(desktop.solopi_ai, 'AdbClient'), \
             mock.patch.object(desktop.solopi_ai, 'session_from_args', return_value=session), \
             mock.patch.object(desktop.solopi_ai, 'command_agent_query', return_value=({'success':True,'session':state}, 0)) as query, \
             mock.patch.object(desktop.solopi_ai, 'command_agent_mutation') as mutate:
            self.assertTrue(self.control.virtual_recover({'config':config,'ownerToken':'a'*64})['cleanupConfirmed'])
            query.assert_called_once()
            state['cleanupPending'] = True
            mutate.return_value = ({'success':True,'session':{**state,'cleanupPending':False}}, 0)
            self.assertTrue(self.control.virtual_recover({'config':config,'ownerToken':'a'*64})['cleanupConfirmed'])
            self.assertEqual('cleanup', mutate.call_args.args[2])

    def test_virtual_projection_binds_screenshot_and_limits_actions(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'virtual-test', desktop.cli_args)
        owner.session_id = 'agent-session-test'
        owner.owner_token = 'x' * 32
        owner.adb.pull = mock.Mock(side_effect=lambda remote, local: local.write_bytes(png(100, 100)))
        observed = {'observationId': 'observation-1', 'screenMode': 'virtual', 'displayId': 5, 'windowId': 7, 'screenWidth': 100, 'screenHeight': 100,
                    'windows': [{'id': 7, 'layer': 1, 'bounds': {'left': 0, 'top': 0, 'right': 100, 'bottom': 100}}],
                    'deviceTiming': {'screenCreateMs': 20, 'ocrAndRevalidationMs': 31, 'captureTotalMs': 100,
                                     'unexpected': 2, 'pngWriteMs': '<invalid>'},
                    'screenshotPath': '/storage/emulated/0/solopi/agent-sessions/agent-session-test/virtual-observation-ab12.png',
                    'screenshotSha256': hashlib.sha256(png(100, 100)).hexdigest(),
                    'page': {'packageName': 'com.example.demo', 'nodeId': 'node-1', 'text': 'open',
                             'isVisibleToUser': True, 'isEnabled': True, 'isClickable': True, 'children': []},
                    'ocr': {'freshness': 'current', 'lines': [
                        {'lineId': 'ocr-1', 'text': 'open', 'pixelsMatch': True, 'protected': False,
                         'bounds': {'left': 1, 'top': 1, 'right': 10, 'bottom': 10}},
                        {'lineId': 'ocr-2', 'text': 'secret', 'pixelsMatch': True, 'protected': True},
                    ]}}
        frame = owner._frame(observed)
        self.assertEqual({'screenCreateMs': 20, 'ocrAndRevalidationMs': 31, 'captureTotalMs': 100}, owner.evidence[-1]['deviceTiming'])
        self.assertIsInstance(owner.evidence[-1]['hostPullAndValidateMs'], int)
        owner._write_report('pending')
        report = (owner.root / 'report.html').read_text()
        self.assertIn('OCR 与画面复核 31 ms', report)
        skipped = dict(observed, ocrSkipped=True)
        owner._frame(skipped)
        owner._write_report('pending')
        self.assertIn('OCR 与画面复核 验收阶段跳过', (owner.root / 'report.html').read_text())
        self.assertNotIn('<invalid>', report)
        with self.assertRaisesRegex(desktop.Error, 'virtual_observation_identity_mismatch'):
            owner._frame({**observed, 'displayId': 6})
        with self.assertRaisesRegex(desktop.Error, 'virtual_screenshot_geometry_mismatch'):
            owner._frame({**observed, 'screenWidth': 99})
        self.assertIsNone(owner.current)
        self.assertEqual({}, owner.targets)
        owner._frame(observed)
        self.assertEqual(['node-1'], [n['id'] for n in frame['nodes']])
        self.assertEqual(['ocr-1'], [n['id'] for n in frame['ocr']])
        self.assertTrue(frame['screenshotDataUrl'].startswith('data:image/png;base64,'))
        with self.assertRaisesRegex(desktop.Error, 'invalid_virtual_action'):
            owner.act({'observationId': 'observation-1', 'targetId': 'ocr-1', 'action': 'click', 'x': 10})
        with self.assertRaisesRegex(desktop.Error, 'stale_observation'):
            owner.act({'observationId': 'observation-old', 'targetId': 'node-1', 'action': 'click'})
        with self.assertRaisesRegex(desktop.Error, 'unknown_virtual_target'):
            owner.act({'observationId': 'observation-1', 'targetId': 'node-1', 'action': 'back'})
        bad = dict(observed, screenshotPath='/storage/emulated/0/solopi/agent-sessions/other/virtual-observation-ab12.png')
        with self.assertRaisesRegex(desktop.Error, 'virtual_screenshot_identity_mismatch'): owner._frame(bad)

    def test_virtual_start_without_receipt_keeps_cleanup_unconfirmed(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'virtual-uncertain', desktop.cli_args)
        owner.owner_token = 'x' * 32
        owner.adb.start_dispatched = True
        session = mock.MagicMock()
        session.__enter__.return_value = session
        session.agent.return_value = {'success': False, 'errorCode': 'session_not_found'}
        with mock.patch.object(virtual_desktop.solopi_ai, 'session_from_args', return_value=session):
            with self.assertRaisesRegex(desktop.Error, 'virtual_cleanup_unconfirmed'): owner.close()
        self.assertEqual('x' * 32, owner.owner_token)

    def test_virtual_start_persists_pending_report_before_first_action(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342,
                  'fixedChecks': [{'selectorKey': 'text', 'selectorValue': 'result', 'operator': 'equals', 'expected': 'ok'}]}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'pending-start', desktop.cli_args)
        owner.adb.connect = mock.Mock()
        def start(args, _adb):
            return ({'success': True, 'session': {'sessionId': 'agent-session-test'},
                     'ownerToken': args.owner_token, 'observation': {'observationId': 'initial'}}, 0)
        owner._initial_frame = mock.Mock(return_value={'observationId': 'initial'})
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_doctor', return_value=({'success': True}, 0)), \
             mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_session_start', side_effect=start):
            start_result = owner.start()
            self.assertEqual('initial', start_result['observationId'])
            self.assertEqual('pending', start_result['pendingReport']['cleanup'])
            self.assertEqual(str(owner.root / 'report.html'), start_result['pendingReport']['reportPath'])
        report = json.loads((owner.root / 'report.json').read_text())
        self.assertEqual('agent-session-test', report['sessionId'])
        self.assertEqual('pending', report['cleanup'])
        self.assertEqual('not_tested', report['status'])
        self.assertEqual([], report['events'])
        self.assertTrue((owner.root / 'report.html').is_file())

    def test_virtual_start_refreshes_stale_ocr_with_a_bounded_limit(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'initial-ocr', desktop.cli_args)
        owner._frame = mock.Mock(return_value={'ocrError': 'stale_observation'})
        owner.observe = mock.Mock(return_value={'ocrError': None, 'ocrFreshness': 'current'})
        frame = owner._initial_frame({'observationId': 'old'})
        self.assertTrue(frame['ocrInitialRefresh'])
        owner.observe.assert_called_once_with()
        owner.observe.reset_mock()
        owner._frame.return_value = {'ocrError': 'ocr_unavailable'}
        self.assertNotIn('ocrInitialRefresh', owner._initial_frame({'observationId': 'old'}))
        owner.observe.assert_not_called()
        owner._frame.return_value = {'ocrError': None, 'ocrFreshness': 'frame_expired'}
        owner.observe.return_value = {'ocrError': 'stale_observation'}
        frame = owner._initial_frame({'observationId': 'old'})
        self.assertEqual('stale_observation', frame['ocrError'])
        self.assertEqual(2, frame['ocrInitialRefreshCount'])
        self.assertEqual(2, owner.observe.call_count)

    def test_failed_virtual_observe_invalidates_previous_targets(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'failed-observe', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.current = {'observationId': 'old'}; owner.targets = {'node-1': {'click'}}
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_observe', return_value=({'success': False}, 2)):
            with self.assertRaises(desktop.Error): owner.observe()
        self.assertIsNone(owner.current)
        self.assertEqual({}, owner.targets)

    def test_unconfirmed_virtual_action_blocks_new_actions_after_observing(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'uncertain-action', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.adb.pull = mock.Mock(side_effect=lambda remote, local: local.write_bytes(png(100, 100)))
        observed = judgment_observation()
        observed.update({'screenshotPath': '/storage/emulated/0/solopi/agent-sessions/agent-session-test/virtual-observation-ab12.png',
                         'screenshotSha256': hashlib.sha256(png(100, 100)).hexdigest()})
        observed['page']['children'][0].update({'nodeId': 'node-1', 'isEnabled': True, 'isClickable': True})
        frame = owner._frame(observed)
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_act',
                               return_value=({'receipt': {'status': 'failed', 'errorCode': 'action_failed'}}, 1)) as send:
            with self.assertRaises(desktop.Error):
                owner.act({'observationId': frame['observationId'], 'targetId': 'node-1', 'action': 'click'})
        self.assertEqual(1, send.call_count)
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_observe',
                               return_value=({'success': True, 'observation': observed}, 0)):
            fresh = owner.observe()
        self.assertEqual('virtual_action_outcome_unconfirmed', fresh['actionBlockedReason'])
        self.assertEqual([], fresh['nodes'][0]['actions'])
        self.assertEqual({}, owner.targets)
        with self.assertRaisesRegex(desktop.Error, 'virtual_action_outcome_unconfirmed'):
            owner.act({'observationId': fresh['observationId'], 'targetId': 'node-1', 'action': 'click'})

    def test_virtual_action_transport_exception_keeps_session_blocked(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'lost-action', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.current = {'observationId': 'obs-1'}; owner.targets = {'node-1': {'click'}}
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_act', side_effect=OSError('lost receipt')):
            with self.assertRaises(OSError):
                owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})
        self.assertTrue(owner.action_outcome_unknown)
        self.assertEqual('submitted', owner.events[0]['state'])
        with self.assertRaisesRegex(desktop.Error, 'virtual_action_outcome_unconfirmed'):
            owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})

    def test_virtual_action_success_without_valid_settled_frame_keeps_session_blocked(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'bad-settled', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.current = {'observationId': 'obs-1'}; owner.targets = {'node-1': {'click'}}
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_act',
                               return_value=({'receipt': {'status': 'succeeded', 'settledObservation': {}}}, 0)):
            with self.assertRaisesRegex(desktop.Error, 'virtual_observation_identity_mismatch'):
                owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})
        self.assertTrue(owner.action_outcome_unknown)
        self.assertEqual('unconfirmed', owner.events[0]['state'])
        self.assertIsNone(owner.current)
        self.assertEqual({}, owner.targets)

    def test_duplicate_action_labels_cannot_be_selected_by_guessing_node_id(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'ambiguous-label', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.adb.pull = mock.Mock(side_effect=lambda remote, local: local.write_bytes(png(100, 100)))
        observed = judgment_observation()
        observed.update({'screenshotPath': '/storage/emulated/0/solopi/agent-sessions/agent-session-test/virtual-observation-ab12.png',
                         'screenshotSha256': hashlib.sha256(png(100, 100)).hexdigest()})
        base = {'packageName': 'com.example.demo', 'isVisibleToUser': True, 'isPassword': False,
                'isEnabled': True, 'isClickable': True, 'isScrollable': False,
                'text': '查看', 'description': '', 'className': 'android.widget.Button',
                'nodeBound': {'left': 10, 'top': 10, 'right': 40, 'bottom': 40}, 'children': []}
        observed['page']['children'] = [dict(base,nodeId='node-1'),dict(base,nodeId='node-2',isEnabled=False),
                                       dict(base,nodeId='node-3',description='订单详情')]
        frame=owner._frame(observed)
        ambiguous=next(n for n in frame['nodes'] if n['id']=='node-1')
        self.assertEqual([],ambiguous['actions']);self.assertEqual('ambiguous_label',ambiguous['blockedReason'])
        self.assertNotIn('node-1',owner.targets);self.assertIn('node-3',owner.targets)
        with self.assertRaisesRegex(desktop.Error,'unknown_virtual_target'):
            owner.act({'observationId':'obs-1','targetId':'node-1','action':'click'})

    def test_duplicate_ocr_text_is_readable_but_not_actionable(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'duplicate-ocr', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.adb.pull = mock.Mock(side_effect=lambda remote, local: local.write_bytes(png(100, 100)))
        observation = judgment_observation()
        observation['page']['children'] = []
        observation.update({'screenshotPath': '/storage/emulated/0/solopi/agent-sessions/agent-session-test/virtual-observation-ab12.png',
                            'screenshotSha256': hashlib.sha256(png(100, 100)).hexdigest()})
        def line(index, text, top):
            return {'lineId': 'ocr-' + str(index), 'text': text, 'pixelsMatch': True, 'protected': False,
                    'bounds': {'left': 10, 'top': top, 'right': 40, 'bottom': top + 10}}
        observation['ocr'] = {'lines': [line(1, '查看', 10), line(2, ' 查看 ', 30), line(3, '订单', 50)]}
        frame = owner._frame(observation)
        self.assertEqual([False, False, True], [line['actionCandidate'] for line in frame['ocr']])
        self.assertEqual(['ambiguous_label', 'ambiguous_label'], [line['blockedReason'] for line in frame['ocr'][:2]])
        self.assertIn('ocr-3', owner.targets)
        with self.assertRaisesRegex(desktop.Error, 'unknown_virtual_target'):
            owner.act({'observationId': observation['observationId'], 'targetId': 'ocr-1', 'action': 'click'})

    def test_ocr_text_requires_visible_owned_window_and_uncovered_geometry(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'ocr-window', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.adb.pull = mock.Mock(side_effect=lambda remote, local: local.write_bytes(png(100, 100)))
        observation = judgment_observation()
        observation['page']['children'] = []
        observation.update({'screenshotPath': '/storage/emulated/0/solopi/agent-sessions/agent-session-test/virtual-observation-ab12.png',
                            'screenshotSha256': hashlib.sha256(png(100, 100)).hexdigest()})
        def line(index, text, bounds):
            return {'lineId': 'ocr-' + str(index), 'text': text, 'pixelsMatch': True, 'protected': False, 'bounds': bounds}
        observation['ocr'] = {'lines': [
            line(1, '可见', {'left': 10, 'top': 10, 'right': 30, 'bottom': 20}),
            line(2, '遮挡', {'left': 60, 'top': 10, 'right': 80, 'bottom': 20}),
            line(3, '越界', {'left': 95, 'top': 10, 'right': 105, 'bottom': 20}),
        ]}
        observation['windows'].append({'id': 8, 'layer': 2, 'bounds': {'left': 50, 'top': 0, 'right': 100, 'bottom': 50}})
        frame = owner._frame(observation)
        self.assertEqual(['可见'], [line['text'] for line in frame['ocr']])
        self.assertTrue(frame['ocr'][0]['actionCandidate'])
        for blocked in ('ocr-2', 'ocr-3'):
            with self.assertRaisesRegex(desktop.Error, 'unknown_virtual_target'):
                owner.act({'observationId': observation['observationId'], 'targetId': blocked, 'action': 'click'})

    def test_virtual_readable_text_is_visible_owned_and_never_actionable(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'readable', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.adb.pull = mock.Mock(side_effect=lambda remote, local: local.write_bytes(png(100, 100)))
        observation = judgment_observation()
        base = {'packageName': 'com.example.demo', 'isVisibleToUser': True, 'isPassword': False,
                'isEnabled': True, 'isClickable': False, 'isScrollable': False,
                'nodeBound': {'left': 10, 'top': 10, 'right': 40, 'bottom': 40}, 'children': []}
        observation['page']['children'] = [
            {**base, 'nodeId': 'node-1', 'text': '可读文字'},
            {**base, 'nodeId': 'node-2', 'text': '停用说明', 'isEnabled': False},
            {**base, 'nodeId': 'node-3', 'text': '隐藏文字', 'isVisibleToUser': False},
            {**base, 'nodeId': 'node-4', 'text': '密码', 'isPassword': True},
            {**base, 'nodeId': 'node-5', 'text': '其他应用', 'packageName': 'other.app'},
            {**base, 'nodeId': 'node-6', 'text': '越界', 'nodeBound': {'left': 90, 'top': 90, 'right': 110, 'bottom': 110}},
            {**base, 'nodeId': 'node-7', 'text': '按钮', 'isClickable': True},
        ]
        observation.update({'screenshotPath': '/storage/emulated/0/solopi/agent-sessions/agent-session-test/virtual-observation-ab12.png',
                            'screenshotSha256': hashlib.sha256(png(100, 100)).hexdigest()})
        frame = owner._frame(observation)
        self.assertEqual(['可读文字', '停用说明'], [n['text'] for n in frame['readableNodes']])
        self.assertFalse(frame['readableNodes'][1]['enabled'])
        self.assertEqual(['node-7'], [n['id'] for n in frame['nodes']])
        with self.assertRaisesRegex(desktop.Error, 'unknown_virtual_target'):
            owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})
        observation['windows'].append({'id': 8, 'layer': 2, 'bounds': {'left': 0, 'top': 0, 'right': 50, 'bottom': 50}})
        self.assertEqual([], owner._frame(observation)['readableNodes'])

    def test_virtual_preflight_failure_does_not_require_device_cleanup(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'virtual-preflight', desktop.cli_args)
        owner.owner_token = 'x' * 32
        self.assertTrue(owner.close()['cleanupConfirmed'])
        self.assertIsNone(owner.owner_token)

    def test_virtual_fixed_judge_uses_frozen_checks_and_real_observation(self):
        check = {'selectorKey': 'resourceId', 'selectorValue': 'status', 'operator': 'equals', 'expected': '已支付'}
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342, 'fixedChecks': [check]}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'judge', desktop.cli_args)
        check['expected'] = '已取消'
        bind_judgment_evidence(owner, judgment_observation())
        owner.observe = mock.Mock(return_value={})
        owner._judge(True)
        owner.observe.assert_called_once_with(skip_ocr=True)
        self.assertEqual('passed', owner.judgement[0]['status'])
        self.assertEqual('已支付', owner.judgement[0]['oracle']['expected'])
        self.assertEqual('not_tested', owner._write_report('pending')['status'])
        self.assertEqual('passed', owner._write_report('confirmed')['status'])
        self.assertTrue((owner.root / 'report.html').exists())

    def test_virtual_judge_rejects_wrong_result_and_does_not_claim_unobserved_pass(self):
        check = {'selectorKey': 'resourceId', 'selectorValue': 'status', 'operator': 'equals', 'expected': '已支付'}
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342, 'fixedChecks': [check]}
        def make(name):
            return virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / name, desktop.cli_args)
        failed = make('failed')
        bind_judgment_evidence(failed, judgment_observation('已取消'))
        failed.observe = mock.Mock(return_value={}); failed._judge(True)
        self.assertEqual('failed', failed._write_report('confirmed')['status'])
        cancelled = make('cancelled'); cancelled._judge(False)
        self.assertEqual('not_tested', cancelled._write_report('confirmed')['status'])
        missing = make('missing'); missing.current = {'observationId': 'obs-2', 'page': {'children': []}}
        missing.observe = mock.Mock(return_value={}); missing._judge(True)
        self.assertEqual('not_tested', missing._write_report('confirmed')['status'])
        unavailable = make('unavailable'); unavailable.observe = mock.Mock(side_effect=OSError('disconnected'))
        unavailable._judge(True)
        self.assertEqual('not_tested', unavailable._write_report('confirmed')['status'])

    def test_virtual_judge_never_passes_hidden_occluded_or_missing_evidence(self):
        check = {'selectorKey': 'resourceId', 'selectorValue': 'status', 'operator': 'equals', 'expected': '已支付'}
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342, 'fixedChecks': [check]}
        overlay = {'id': 8, 'layer': 2, 'bounds': {'left': 0, 'top': 0, 'right': 50, 'bottom': 50}}
        for name, observation, reason in [('hidden', judgment_observation(visible=False), 'target_not_visibly_observable'),
                                          ('occluded', judgment_observation(overlays=[overlay]), 'target_occluded')]:
            owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / name, desktop.cli_args)
            bind_judgment_evidence(owner, observation); owner.observe = mock.Mock(return_value={}); owner._judge(True)
            result = owner._write_report('confirmed')
            self.assertEqual('not_tested', result['status'])
            self.assertEqual(reason, result['checkpoints'][0]['reason'])
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'missing-evidence', desktop.cli_args)
        bind_judgment_evidence(owner, judgment_observation()); owner.observe = mock.Mock(return_value={}); owner._judge(True)
        (owner.root / 'frame.png').unlink()
        self.assertEqual('evidence_unavailable', owner._write_report('confirmed')['checkpoints'][0]['reason'])
        self.assertEqual('not_tested', owner._write_report('confirmed')['status'])
        changed = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'changed-evidence', desktop.cli_args)
        bind_judgment_evidence(changed, judgment_observation()); changed.observe = mock.Mock(return_value={}); changed._judge(True)
        (changed.root / 'observation.json').write_text('{}', encoding='utf-8')
        self.assertEqual('not_tested', changed._write_report('confirmed')['status'])
        receipt = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'changed-receipt', desktop.cli_args)
        bind_judgment_evidence(receipt, judgment_observation()); receipt.observe = mock.Mock(return_value={}); receipt._judge(True)
        raw = json.dumps({'status':'succeeded','stepId':'step-1','observationId':'obs-1'}).encode('utf-8')
        (receipt.root / 'receipt.json').write_bytes(raw)
        receipt.events = [{'type':'action','action':'click','targetId':'node-1','state':'succeeded','stepId':'step-1',
                           'observationId':'obs-1','receipt':'receipt.json','receiptSha256':hashlib.sha256(raw).hexdigest()}]
        self.assertEqual('passed', receipt._write_report('confirmed')['status'])
        (receipt.root / 'receipt.json').write_text('{}', encoding='utf-8')
        self.assertEqual('not_tested', receipt._write_report('confirmed')['status'])

    def test_virtual_judge_rejects_ambiguous_foreign_and_invalid_geometry(self):
        oracle = {'type': 'ui', 'selector': {'resourceId': 'status'}, 'field': 'text', 'operator': 'equals', 'expected': '已支付'}
        foreign = judgment_observation(); foreign['page']['children'][0]['packageName'] = 'com.other.app'
        invalid = judgment_observation(); invalid['page']['children'][0]['nodeBound']['right'] = 101
        ambiguous = judgment_observation(); ambiguous['page']['children'].append(copy.deepcopy(ambiguous['page']['children'][0]))
        for observation, reason in ((foreign, 'target_not_visibly_observable'), (invalid, 'target_geometry_unknown'),
                                    (ambiguous, 'ambiguous_selector')):
            status, actual_reason, actual = virtual_desktop._visible_oracle_result(oracle, observation, 'com.example.demo')
            self.assertEqual(('not_tested', reason, None), (status, actual_reason, actual))

    def test_invalid_virtual_fixed_checks_are_rejected_before_session_start(self):
        base = {'platform': 'android', 'deviceId': 'device', 'deviceKind': 'physical',
                'appId': 'com.example.demo', 'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        for check in ({'selectorKey': [], 'selectorValue': 'x', 'operator': 'equals', 'expected': 'x'},
                      {'selectorKey': 'resourceId', 'selectorValue': '', 'operator': 'equals', 'expected': 'x'},
                      {'selectorKey': 'resourceId', 'selectorValue': 'x', 'operator': [], 'expected': 'x'}):
            with self.assertRaisesRegex(desktop.Error, 'invalid_fixed_checks'):
                desktop.checked_config({**base, 'fixedChecks': [check]})

    def test_report_export_failure_never_prevents_device_cleanup(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'report-failed', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32; owner.adb.start_dispatched = True
        owner._judge = mock.Mock()
        owner._write_report = mock.Mock(side_effect=OSError('disk unavailable'))
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_query', return_value=(
                {'success': True, 'session': {'state': 'cancelled', 'leaseHeld': False, 'cleanupPending': False}}, 0)):
            result = owner.close(completed=True)
        self.assertTrue(result['cleanupConfirmed'])
        self.assertEqual('not_tested', result['report']['status'])
        self.assertEqual('report_export_failed', result['report']['error'])

    def test_protected_frame_error_preserves_uncertain_action_outcome(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'protected', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.current = {'observationId': 'obs-1'}; owner.targets = {'node-1': {'click'}}
        receipt = {'status': 'failed', 'errorCode': 'action_failed',
                   'error': 'Virtual action was submitted; protected or blank frame prevents confirmation'}
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_act', return_value=({'receipt': receipt}, 2)):
            with self.assertRaisesRegex(desktop.Error, 'virtual_protected_or_blank_after_dispatch'):
                owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})
        self.assertEqual('unconfirmed', owner.events[0]['state'])
        self.assertIsNone(owner.current)

    def test_virtual_settle_timeout_is_explained_and_does_not_replay(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'settle-timeout', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.current = {'observationId': 'obs-1'}; owner.targets = {'node-1': {'click'}}
        receipt = {'status': 'failed', 'errorCode': 'action_failed',
                   'error': 'Virtual action was submitted; settle timed out (reason=virtual_observation_unstable); outcome may be unknown'}
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_act', return_value=({'receipt': receipt}, 2)) as send:
            with self.assertRaisesRegex(desktop.Error, 'virtual_settle_unconfirmed'):
                owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})
            with self.assertRaisesRegex(desktop.Error, 'virtual_action_outcome_unconfirmed'):
                owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})
            self.assertEqual(1, send.call_count)

    def test_virtual_target_on_main_stops_and_does_not_replay(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'target-on-main', desktop.cli_args)
        owner.session_id = 'agent-session-test'; owner.owner_token = 'x' * 32
        owner.current = {'observationId': 'obs-1'}; owner.targets = {'node-1': {'click'}}
        receipt = {'status': 'failed', 'errorCode': 'action_failed',
                   'error': 'Virtual action was submitted; target is active on main display; outcome may be unknown'}
        with mock.patch.object(virtual_desktop.solopi_ai, 'command_agent_act', return_value=({'receipt': receipt}, 2)) as send:
            with self.assertRaisesRegex(desktop.Error, 'virtual_target_on_main'):
                owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})
            with self.assertRaisesRegex(desktop.Error, 'virtual_action_outcome_unconfirmed'):
                owner.act({'observationId': 'obs-1', 'targetId': 'node-1', 'action': 'click'})
            self.assertEqual(1, send.call_count)

    def test_virtual_viewport_is_offered_only_for_empty_root_with_verified_ocr(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'viewport-test', desktop.cli_args)
        owner.session_id = 'agent-session-test'
        owner.adb.pull = mock.Mock(side_effect=lambda remote, local: local.write_bytes(png(100, 100)))
        root = {'packageName': 'com.example.demo', 'nodeId': 'node-1', 'text': '', 'description': '',
                'isVisibleToUser': True, 'isEnabled': True, 'isClickable': False, 'isScrollable': False, 'children': []}
        observed = {'observationId': 'obs-1', 'screenMode': 'virtual', 'displayId': 5, 'windowId': 7, 'screenWidth': 100, 'screenHeight': 100,
                    'windows': [{'id': 7, 'layer': 1, 'bounds': {'left': 0, 'top': 0, 'right': 100, 'bottom': 100}}],
                    'screenshotPath': '/storage/emulated/0/solopi/agent-sessions/agent-session-test/virtual-observation-ab12.png',
                    'screenshotSha256': hashlib.sha256(png(100, 100)).hexdigest(), 'page': root,
                    'ocr': {'lines': [{'lineId': 'ocr-1', 'text': '可见', 'pixelsMatch': True,
                                       'bounds': {'left': 1, 'top': 1, 'right': 10, 'bottom': 10}}]}}
        self.assertEqual('viewport-1', owner._frame(observed)['viewport']['id'])
        with self.assertRaisesRegex(desktop.Error, 'invalid_scroll_direction'):
            owner.act({'observationId': 'obs-1', 'targetId': 'viewport-1', 'action': 'scroll', 'direction': 'left'})
        self.assertIsNone(owner._frame({**observed, 'page': {**root, 'isClickable': True}})['viewport'])
        self.assertIsNone(owner._frame({**observed, 'ocr': {'lines': []}})['viewport'])
        self.assertIsNone(owner._frame({**observed, 'windows': [{'id': 7, 'layer': 1, 'bounds': {'left': 20, 'top': 20, 'right': 80, 'bottom': 80}}]})['viewport'])

    def test_ocr_cannot_bypass_disabled_accessible_control(self):
        config = {'platform': 'android', 'deviceId': 'device', 'appId': 'com.example.demo',
                  'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        owner = virtual_desktop.VirtualDesktopSession(config, Path(self.temp.name) / 'disabled-ocr', desktop.cli_args)
        owner.session_id = 'agent-session-test'
        owner.adb.pull = mock.Mock(side_effect=lambda remote, local: local.write_bytes(png(100, 100)))
        bounds = {'left': 1, 'top': 1, 'right': 50, 'bottom': 50}
        root = {'packageName': 'com.example.demo', 'nodeId': 'node-1', 'text': '',
                'isVisibleToUser': True, 'isEnabled': True, 'children': [
                    {'packageName': 'com.example.demo', 'nodeId': 'node-2', 'text': '查看',
                     'isVisibleToUser': True, 'isEnabled': False, 'isClickable': True, 'nodeBound': bounds, 'children': []}]}
        observed = {'observationId': 'obs-1', 'screenMode': 'virtual', 'displayId': 5, 'windowId': 7, 'screenWidth': 100, 'screenHeight': 100,
                    'windows': [{'id': 7, 'layer': 1, 'bounds': {'left': 0, 'top': 0, 'right': 100, 'bottom': 100}}],
                    'screenshotPath': '/storage/emulated/0/solopi/agent-sessions/agent-session-test/virtual-observation-ab12.png',
                    'screenshotSha256': hashlib.sha256(png(100, 100)).hexdigest(), 'page': root,
                    'ocr': {'lines': [{'lineId': 'ocr-1', 'text': '查看', 'pixelsMatch': True, 'bounds': bounds}]}}
        frame = owner._frame(observed)
        self.assertFalse(frame['ocr'][0]['actionCandidate'])
        with self.assertRaisesRegex(desktop.Error, 'unknown_virtual_target'):
            owner.act({'observationId': 'obs-1', 'targetId': 'ocr-1', 'action': 'click'})

    def test_apps_uses_validated_android_identity_and_returns_only_names(self):
        config = {**self.config, 'platform': 'android', 'controlPackage': 'com.alipay.hulu', 'controlPort': 23342}
        data = {'success': True, 'apps': [{'packageName': 'com.example.app', 'label': '示例', 'private': 'ignored'},
                                          {'packageName': '../bad', 'label': 'bad'}]}
        with mock.patch.object(desktop.solopi_ai, 'command_query', return_value=(data, 0)) as query:
            self.assertEqual({'apps': [{'packageName': 'com.example.app', 'label': '示例'}]}, self.control.apps(config))
        self.assertEqual('apps', query.call_args.args[2])
        self.assertEqual('sim-test', query.call_args.args[1].requested_serial)
        with self.assertRaises(desktop.Error):
            self.control.apps({**config, 'deviceId': 'bad;command'})
        with self.assertRaises(desktop.Error):
            self.control.apps(self.config)

    def test_record_assert_end_exports_fixed_expected_and_full_screenshot(self):
        frame = self.control.connect(self.config)
        self.assertTrue(frame['screenshotDataUrl'].startswith('data:image/png;base64,'))
        frame = self.click(frame)
        value = next(n for n in frame['elements'] if n['selector'] == {'accessibilityId': 'value'})
        result = self.control.command({'type': 'assert', 'handle': value['handle'], 'expected': 'WRONG',
                                       'observationId': frame['observationId']})
        self.assertEqual('failed', result['assertion']['status'])
        output = self.control.command({'type': 'end'})
        expected = output['requirement']['scenarios'][0]['checkpoints'][0]['oracle']['expected']
        self.assertEqual('WRONG', expected)
        scenario = output['requirement']['scenarios'][0]
        self.assertEqual({'type': 'wait', 'durationMs': 1200}, scenario['steps'][1]['action'])
        self.assertEqual('settle-recorded-1', scenario['checkpoints'][0]['afterStep'])
        verification_engine.compile_verification_plan(output['requirement'])
        self.assertTrue(self.driver.closed)
        record = json.loads((Path(output['artifacts']) / 'recording.json').read_text())
        self.assertEqual('completed', record['state'])
        self.assertEqual(1, len(record['steps']))

    def test_stale_observation_never_dispatches(self):
        frame = self.control.connect(self.config)
        self.control.observe()
        with self.assertRaisesRegex(desktop.Error, 'stale_observation'): self.click(frame)
        self.assertEqual(0, self.driver.count)

    def test_target_replaced_is_rejected(self):
        frame = self.control.connect(self.config)
        self.driver.replace = True
        with self.assertRaisesRegex(desktop.Error, 'target_changed'): self.click(frame)
        self.assertEqual(0, self.driver.count)

    def test_unknown_action_outcome_is_persisted_and_not_retried(self):
        frame = self.control.connect(self.config)
        self.driver.fail_after_send = True
        with self.assertRaisesRegex(desktop.Error, 'action_outcome_unknown'): self.click(frame)
        self.assertEqual('interrupted', self.control.recorder.state)
        with self.assertRaises(desktop.Error): self.click(frame)
        self.assertEqual(1, self.driver.count)
        record = json.loads((self.control.recorder.root / 'recording.json').read_text())
        self.assertEqual('outcome_unknown', record['events'][-1]['state'])

    def test_handles_and_action_types_are_not_arbitrary_selectors_or_shell(self):
        frame = self.control.connect(self.config)
        for change in ({'handle': '../../other'}, {'action': 'shell'}):
            with self.assertRaises(desktop.Error):
                self.control.command({'type': 'act', 'action': 'click', 'handle': '1',
                                      'observationId': frame['observationId'], **change})
        self.assertEqual(0, self.driver.count)

    def test_second_connection_does_not_replace_owner(self):
        self.control.connect(self.config)
        with self.assertRaisesRegex(desktop.Error, 'device_session_busy'): self.control.connect(self.config)

    def test_close_preserves_interrupted_recording(self):
        self.control.connect(self.config)
        root = self.control.recorder.root
        self.control.close()
        self.assertEqual('interrupted', json.loads((root / 'recording.json').read_text())['state'])
        self.assertTrue(self.driver.closed)

    def test_finish_without_explicit_assertion_rejected(self):
        self.click(self.control.connect(self.config))
        with self.assertRaisesRegex(desktop.Error, 'recording_requires_fixed_assertion'):
            self.control.command({'type': 'end'})

    def test_foreign_platform_replay_rejected_before_running(self):
        self.click(self.control.connect(self.config))
        self.control.recorder.checkpoints = [{'id': 'c', 'afterStep': 'recorded-1', 'oracle': {
            'type': 'ui', 'selector': {'accessibilityId': 'value'}, 'field': 'text', 'operator': 'equals', 'expected': '1'}}]
        requirement = self.control.command({'type': 'end'})['requirement']
        with mock.patch.object(desktop.solopi_ai, 'command_verify_run') as run:
            with self.assertRaisesRegex(desktop.Error, 'device_binding_mismatch'):
                self.control.replay({'config': {**self.config, 'appId': 'org.other'}, 'requirement': requirement})
            run.assert_not_called()

    def test_replay_calls_fixed_judge_and_preserves_failed_verdict(self):
        self.click(self.control.connect(self.config))
        self.control.recorder.checkpoints = [{'id': 'c', 'afterStep': 'recorded-1', 'oracle': {
            'type': 'ui', 'selector': {'accessibilityId': 'value'}, 'field': 'text', 'operator': 'equals', 'expected': '99'}}]
        requirement = self.control.command({'type': 'end'})['requirement']
        with mock.patch.object(desktop.solopi_ai, 'command_verify_run', return_value=({'status': 'failed'}, 2)) as run:
            result = self.control.replay({'config': self.config, 'requirement': requirement})
        self.assertEqual(2, result['exitCode'])
        self.assertEqual('failed', result['result']['status'])
        self.assertEqual('sim-test', run.call_args.args[0].native_device)

    def test_invalid_targets_and_physical_next_rejected(self):
        for update in ({'deviceId': '; echo bad'}, {'platform': 'other'}, {'wdaPort': True},
                       {'appId': '../private'}, {'executable': 'sh'},
                       {'platform': 'harmony_next', 'deviceKind': 'physical'}):
            with self.assertRaises(desktop.Error): desktop.checked_config({**self.config, **update})

    def android_requirement(self):
        return {'schemaVersion': 'solopi.ai.requirement/v1', 'platform': 'android',
                'targetAppId': 'org.example.Counter', 'targetAppPackage': 'org.example.Counter',
                'id': 'desktop-test', 'title': 'Desktop test',
                'acceptanceCriteria': [{'id': 'AC-1', 'text': 'Fixed result'}],
                'scenarios': [{'id': 'flow', 'title': 'Flow', 'acceptanceCriteria': ['AC-1'],
                               'steps': [{'id': 'wait', 'type': 'operation',
                                          'action': {'type': 'wait', 'durationMs': 100}}],
                               'checkpoints': [{'id': 'fixed', 'afterStep': 'wait', 'oracle': {
                                   'type': 'ui', 'selector': {'resourceId': 'value'}, 'field': 'text',
                                   'operator': 'equals', 'expected': '1'}}]}]}

    def test_android_fixed_replay_exports_html_without_changing_failed_verdict(self):
        def run(args, _adb):
            root = Path(args.artifacts)
            root.mkdir()
            report = root / 'report.json'
            report.write_text(json.dumps({'status': 'failed'}))
            (root / 'screen.png').write_bytes(png())
            return {'status': 'failed', 'report': str(report)}, 2
        with mock.patch.object(desktop.solopi_ai, 'command_verify_run', side_effect=run):
            result = self.control.replay({'config': {**self.config, 'platform': 'android'},
                                         'requirement': self.android_requirement()})
        self.assertEqual('failed', result['result']['status'])
        self.assertEqual(2, result['exitCode'])
        html = Path(result['result']['htmlReport']).read_text()
        self.assertIn('SoloPi Desktop 回归证据', html)
        self.assertIn('screen.png', html)

    def test_android_runner_failure_without_report_preserved(self):
        with mock.patch.object(desktop.solopi_ai, 'command_verify_run', return_value=(
                {'success': False, 'status': 'not_tested', 'errorCode': 'device_offline'}, 2)):
            result = self.control.replay({'config': {**self.config, 'platform': 'android'},
                                         'requirement': self.android_requirement()})
        self.assertEqual(2, result['exitCode'])
        self.assertEqual('device_offline', result['result']['errorCode'])
        self.assertEqual('report_unavailable', result['result']['htmlExportError'])

    def test_interrupted_android_replay_persists_owned_cleanup(self):
        with mock.patch.object(desktop.solopi_ai, 'command_verify_run', side_effect=KeyboardInterrupt), \
                mock.patch.object(desktop.DesktopReplayAdb, 'finish', return_value={'state': 'cancelled'}) as finish:
            with self.assertRaises(KeyboardInterrupt):
                self.control.replay({'config': {**self.config, 'platform': 'android'},
                                     'requirement': self.android_requirement()})
        finish.assert_called_once()
        files = list(Path(self.temp.name).glob('replay-*/desktop-cleanup.json'))
        self.assertEqual('cancelled', json.loads(files[0].read_text())['state'])

    def test_ambiguous_nodes_have_no_selectors(self):
        node = {'text': 'same', 'className': 'Button'}
        self.assertIsNone(desktop.selector_for(node, [node, copy.deepcopy(node)], 'ios'))

    def test_next_selector_ignores_transient_accessibility_number(self):
        node = {'id': 'open_details', 'accessibilityId': '13', 'text': 'Details'}
        self.assertEqual({'id': 'open_details'}, desktop.selector_for(node, [node], 'harmony_next'))
        other = {'id': '', 'accessibilityId': '99', 'text': 'Details'}
        self.assertIsNone(desktop.selector_for(other, [other, {**other, 'accessibilityId': '100'}], 'harmony_next'))

    def test_android_preflight_failure_does_not_launch(self):
        session = desktop.AndroidSession(desktop.checked_config({**self.config, 'platform': 'android'}))
        session.adb = mock.Mock()
        with mock.patch.object(desktop.solopi_ai, 'command_doctor', return_value=({'success': False}, 2)):
            with self.assertRaisesRegex(desktop.Error, 'android_setup_required'): session.ensure_ready()
        session.adb.launch.assert_not_called()

    def test_stdio_malformed_request_remains_bounded_and_returns_no_trace(self):
        result = subprocess.run([sys.executable, '-m', 'solopi_harness.desktop_control', '--artifacts', self.temp.name],
                                input='[]\n{"id":"a","operation":"shell"}\n', text=True, capture_output=True,
                                env={**__import__('os').environ, 'PYTHONPATH': str(Path(__file__).resolve().parents[1] / 'src')}, timeout=10)
        self.assertEqual(0, result.returncode)
        self.assertEqual(['invalid_desktop_request', 'unsupported_desktop_operation'],
                         [json.loads(line)['error'] for line in result.stdout.splitlines()])
        self.assertNotIn('Traceback', result.stderr)


class AndroidReceiptTests(unittest.TestCase):
    def setUp(self):
        self.session = desktop.AndroidSession(desktop.checked_config({
            'platform': 'android', 'deviceId': 'test-device', 'deviceKind': 'physical',
            'appId': 'org.example.demo'}))
        self.session.session_id = 'session-test'
        self.session.owner_token = 'a' * 64
        self.observation = {'observationId': 'observation-test', 'page': {'children': [
            {'nodeId': 'node-1', 'text': 'Open', 'isEnabled': True, 'isVisibleToUser': True}]}}
        self.session.current = copy.deepcopy(self.observation)
        self.action = {'type': 'click', 'selector': {'text': 'Open'}}
        self.receipt = {'stepId': 'recorded-1', 'observationId': 'observation-test',
                        'status': 'rejected', 'errorCode': 'target_occluded'}

    def test_action_validation_is_strict_by_default_and_opt_in_is_forwarded(self):
        for strategy in ('full-page', 'target-context-v1'):
            session = desktop.AndroidSession(desktop.checked_config({
                **self.session.config, 'actionValidationStrategy': strategy}))
            session.adb = mock.Mock()
            with mock.patch.object(desktop.solopi_ai, 'command_doctor', return_value=({'success': True}, 0)), \
                    mock.patch.object(desktop.solopi_ai, 'command_agent_session_start', return_value=(
                        {'success': True, 'ownerToken': 'test-owner', 'session': {'sessionId': 'new'}}, 0)) as start:
                session.ensure_ready()
            self.assertEqual(strategy, start.call_args.args[0].action_validation_strategy)
        config = {k: v for k, v in self.session.config.items() if k != 'actionValidationStrategy'}
        self.assertEqual('full-page', desktop.checked_config(config)['actionValidationStrategy'])
        with self.assertRaisesRegex(desktop.Error, 'invalid_action_validation_strategy'):
            desktop.checked_config({**config, 'actionValidationStrategy': 'unchecked'})

    def test_bound_rejection_is_preserved_without_retry(self):
        with mock.patch.object(desktop.solopi_ai, 'command_agent_act', return_value=(
                {'success': True, 'receipt': self.receipt}, 2)) as call:
            with self.assertRaisesRegex(desktop.Error, 'target_occluded'):
                self.session.act('recorded-1', self.action, self.observation)
        self.assertEqual(1, call.call_count)
        self.assertEqual('rejected', self.session.last_receipt()['state'])
        self.assertEqual(self.receipt, self.session.last_receipt()['deviceReceipt'])

    def test_foreign_or_missing_receipt_remains_unknown(self):
        for mutation in ({'stepId': 'another-step'}, {'observationId': 'another-observation'},
                         {'status': 'accepted'}, {'status': []}):
            with self.subTest(mutation=mutation):
                self.session.current = copy.deepcopy(self.observation)
                receipt = {**self.receipt, **mutation}
                with mock.patch.object(desktop.solopi_ai, 'command_agent_act', return_value=(
                        {'success': True, 'receipt': receipt}, 2)):
                    with self.assertRaisesRegex(desktop.Error, 'action_outcome_unknown'):
                        self.session.act('recorded-1', self.action, self.observation)
                self.assertEqual('outcome_unknown', self.session.last_receipt()['state'])

    def test_transport_failure_does_not_become_rejection(self):
        with mock.patch.object(desktop.solopi_ai, 'command_agent_act', side_effect=OSError('connection lost')) as call:
            with self.assertRaises(OSError): self.session.act('recorded-1', self.action, self.observation)
        self.assertEqual(1, call.call_count)
        self.assertEqual('outcome_unknown', self.session.last_receipt()['state'])

    def test_raw_device_error_does_not_reach_ui(self):
        receipt = {**self.receipt, 'errorCode': 'private\naccount-data', 'error': 'private details'}
        with mock.patch.object(desktop.solopi_ai, 'command_agent_act', return_value=(
                {'success': True, 'receipt': receipt}, 2)):
            with self.assertRaisesRegex(desktop.Error, '^android_action_rejected$'):
                self.session.act('recorded-1', self.action, self.observation)

    def test_success_requires_consistent_terminal_response(self):
        receipt = {**self.receipt, 'status': 'succeeded'}
        for success, code in ((True, 0), (True, 2), (False, 0)):
            with self.subTest(success=success, code=code):
                self.session.current = copy.deepcopy(self.observation)
                with mock.patch.object(desktop.solopi_ai, 'command_agent_act', return_value=(
                        {'success': success, 'receipt': receipt}, code)):
                    if success and code == 0:
                        self.assertEqual('succeeded', self.session.act('recorded-1', self.action, self.observation)['state'])
                    else:
                        with self.assertRaisesRegex(desktop.Error, 'action_outcome_unknown'):
                            self.session.act('recorded-1', self.action, self.observation)

    def test_recording_keeps_rejection_and_does_not_export_action(self):
        with tempfile.TemporaryDirectory() as root:
            recorder = desktop.DesktopRecorder(self.session, Path(root) / 'record')
            recorder.current = self.observation
            with mock.patch.object(desktop.solopi_ai, 'command_agent_act', return_value=(
                    {'success': True, 'receipt': self.receipt}, 2)), \
                    mock.patch.object(self.session, 'screenshot', return_value=png()):
                with self.assertRaisesRegex(desktop.Error, 'target_occluded'):
                    recorder.command({'type': 'act', 'observationId': 'observation-test', 'action': self.action})
            saved = json.loads((Path(root) / 'record/recording.json').read_text())
            self.assertEqual('recording', saved['state'])
            self.assertEqual([], saved['steps'])
            self.assertEqual('rejected', saved['events'][-1]['state'])
            self.assertEqual('target_occluded', saved['events'][-1]['receipt']['deviceReceipt']['errorCode'])
            self.assertIsNone(recorder.current)
            recorder.current = self.observation
            self.session.current = copy.deepcopy(self.observation)
            fresh_receipt = {**self.receipt, 'stepId': 'recorded-2'}
            with mock.patch.object(desktop.solopi_ai, 'command_agent_act', return_value=(
                    {'success': True, 'receipt': fresh_receipt}, 2)) as call, \
                    mock.patch.object(self.session, 'screenshot', return_value=png()):
                with self.assertRaisesRegex(desktop.Error, 'target_occluded'):
                    recorder.command({'type': 'act', 'observationId': 'observation-test', 'action': self.action})
            self.assertEqual('recorded-2', call.call_args.args[0].step_id)
            self.assertEqual(2, len(recorder.events))

    def test_desktop_rejection_refreshes_without_another_action(self):
        with tempfile.TemporaryDirectory() as root:
            control = desktop.DesktopControl(root)
            control.recorder = desktop.DesktopRecorder(self.session, Path(root) / 'record')
            control.recorder.current = self.observation
            control.handles = {'node-handle': self.action['selector']}
            with mock.patch.object(desktop.solopi_ai, 'command_agent_act', return_value=(
                    {'success': True, 'receipt': self.receipt}, 2)) as call, \
                    mock.patch.object(self.session, 'screenshot', return_value=png()), \
                    mock.patch.object(control, 'observe', return_value={'observationId': 'new-observation'}) as observe:
                result = control.command({'type': 'act', 'action': 'click',
                                          'handle': 'node-handle', 'observationId': 'observation-test'})
            self.assertEqual(1, call.call_count)
            observe.assert_called_once()
            self.assertEqual('rejected', result['receipt']['state'])
            self.assertEqual('target_occluded', result['actionError'])
            self.assertEqual('new-observation', result['observationId'])


class ReplayOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.adb = desktop.DesktopReplayAdb(desktop.checked_config({
            'platform': 'android', 'deviceId': 'test-device', 'deviceKind': 'physical',
            'appId': 'org.example.demo'}))
        self.adb.owned_request = ('owned-request', 'owned-case')
        self.status = {'success': True, 'requestId': 'owned-request', 'caseName': 'owned-case',
                       'runId': 'run-1', 'active': True, 'terminal': False}

    def test_interrupt_only_cancels_exact_owned_run(self):
        with mock.patch.object(desktop.solopi_ai, 'command_query', return_value=(self.status, 0)), \
                mock.patch.object(desktop.solopi_ai, 'command_cancel', return_value=({'state': 'cancelled'}, 0)) as cancel:
            result = self.adb.finish()
        self.assertEqual('cancelled', result['state'])
        self.assertEqual('run-1', cancel.call_args.args[0].run_id)

    def test_foreign_request_or_case_cannot_be_cancelled(self):
        for change in ({'requestId': 'other'}, {'caseName': 'other'}):
            with mock.patch.object(desktop.solopi_ai, 'command_query', return_value=({**self.status, **change}, 0)), \
                    mock.patch.object(desktop.solopi_ai, 'command_cancel') as cancel:
                result = self.adb.finish()
            self.assertEqual('replay_identity_mismatch', result['reason'])
            cancel.assert_not_called()

    def test_terminal_replay_never_cancelled(self):
        with mock.patch.object(desktop.solopi_ai, 'command_query', return_value=(
                {**self.status, 'active': False, 'terminal': True, 'state': 'passed'}, 0)), \
                mock.patch.object(desktop.solopi_ai, 'command_cancel') as cancel:
            result = self.adb.finish()
        self.assertEqual('already_terminal', result['state'])
        cancel.assert_not_called()


if __name__ == '__main__': unittest.main()
