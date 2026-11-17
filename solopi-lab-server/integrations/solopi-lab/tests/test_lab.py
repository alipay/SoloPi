import concurrent.futures
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from solopi_lab.core import Store, Error, OPERATIONS
from solopi_lab.transport import Client, Deliveries, server, checked_url
from solopi_lab.node import Node, compact_report
from solopi_lab.__main__ import mcp, single_instance

A = {'id': 'alice', 'role': 'user', 'targets': ['hook']}
B = {'id': 'bob', 'role': 'user'}
ADMIN = {'id': 'admin', 'role': 'admin'}

def group(i='g1', node='n1', serial=None):
    return {'id': i, 'nodeId': node, 'devices': {'phone': {'serial': serial or 'phone-' + i}, 'glasses': {'serial': 'glass-' + i}}, 'attributes': {'os': 'android'}}

def request(i='r1', cases=None, **extra):
    return {'requestId': i, 'caseIds': cases or ['c1'], **extra}

class LabTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.now = 1000
        self.config = {'heartbeatTTL': 30, 'targets': {'hook': {'command': [sys.executable, '-c', 'pass']}}}
        self.store = Store(self.root / 'co', self.config, lambda: self.now)
        self.store.configure_group(group()); self.store.heartbeat('n1', 2)
    def tearDown(self): self.tmp.cleanup()
    def submit(self, **kwargs): return self.store.call('submit', request(**kwargs), A)
    def claim(self, node='n1'):
        return self.store.claim(node)['assignment']
    def auth(self, a): return {k: a[k] for k in ('jobId', 'lease')}
    def report(self, a, status='success'):
        return {'id': 'task1', 'status': status, 'finishedAt': 'now', 'completed': 1, 'total': 1,
                'devices': a['group']['devices'], 'cases': [{'caseId': 'c1', 'status': status}]}
    def running(self):
        self.submit(); a = self.claim(); self.store.progress('n1', {**self.auth(a), 'taskId': 'task1'}); return a
    def test_duplicate_request_under_concurrency(self):
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda _: self.submit(), range(20)))
        self.assertEqual(len({r['id'] for r in results}), 1)
        with self.assertRaises(Error): self.submit(cases=['different'])
    def test_transactional_claim_only_once(self):
        self.submit()
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            assignments = list(pool.map(lambda _: self.claim(), range(10)))
        self.assertEqual(sum(a is not None for a in assignments), 1)
    def test_multiple_nodes_and_capacity_busy_queue(self):
        self.store.configure_group(group('g2', 'n2')); self.store.heartbeat('n2', 1)
        for i in range(3): self.submit(i=str(i))
        a, b = self.claim('n1'), self.claim('n2')
        self.assertNotEqual(a['group']['devices'], b['group']['devices'])
        self.assertIsNone(self.claim('n1')); self.assertIsNone(self.claim('n2'))
        self.assertEqual(self.store.call('list', {}, A)['jobs'][2]['state'], 'queued')
    def test_duplicate_physical_device_and_busy_edit_refused(self):
        with self.assertRaises(Error): self.store.configure_group(group('g2', 'n2', 'phone-g1'))
        self.submit(); self.claim()
        with self.assertRaises(Error): self.store.configure_group(group())
    def test_expired_node_does_not_free_or_replay(self):
        a = self.running(); self.now += 100
        self.store.configure_group(group('g2', 'n2')); self.store.heartbeat('n2', 1)
        self.assertIsNone(self.claim('n2'))
        self.assertTrue(self.store.call('resources', {}, A)['groups'][0]['busy'])
        self.assertIsNone(self.claim('n1'))
        self.assertEqual(self.store.assignments('n1')['assignments'][0]['jobId'], a['jobId'])
    def test_owner_node_and_token_scope(self):
        a = self.running()
        with self.assertRaises(Error): self.store.call('status', {'jobId': a['jobId']}, B)
        with self.assertRaises(Error): self.store.control('n2', self.auth(a))
        with self.assertRaises(Error): self.store.control('n1', {**self.auth(a), 'lease': 'fake'})
        with self.assertRaises(Error): self.store.call('stop', {'jobId': a['jobId']}, {'role': 'node'})
    def test_stop_waits_for_real_terminal_and_frees_group(self):
        a = self.running()
        self.assertEqual(self.store.call('stop', {'jobId': a['jobId']}, A)['state'], 'stop_requested')
        self.assertIsNone(self.claim())
        self.store.progress('n1', {**self.auth(a), 'state': 'running', 'taskId': 'task1'})
        self.assertEqual(self.store.control('n1', self.auth(a))['state'], 'stop_requested')
        self.store.complete('n1', {**self.auth(a), 'report': self.report(a, 'stopped')})
        self.submit(i='r2'); self.assertIsNotNone(self.claim())
    def test_queued_cancel_no_execution(self):
        j = self.submit(); self.store.call('stop', {'jobId': j['id']}, A)
        self.assertIsNone(self.claim())
    def test_wrong_report_case_device_and_incomplete_refused(self):
        a = self.running()
        report = self.report(a); report['cases'][0]['caseId'] = 'other'
        with self.assertRaises(Error): self.store.complete('n1', {**self.auth(a), 'report': report})
        report = self.report(a); report['devices'] = {}
        with self.assertRaises(Error): self.store.complete('n1', {**self.auth(a), 'report': report})
        report = self.report(a); report['completed'] = 0
        with self.assertRaises(Error): self.store.complete('n1', {**self.auth(a), 'report': report})
    def test_restart_preserves_lease_and_task(self):
        a = self.running(); restored = Store(self.root / 'co', self.config, lambda: self.now)
        self.assertIsNone(restored.claim('n1')['assignment'])
        self.assertEqual(restored.control('n1', self.auth(a))['taskId'], 'task1')
    def test_notification_separate_and_stable_retry(self):
        self.submit(target='hook'); a = self.claim()
        self.store.progress('n1', {**self.auth(a), 'taskId': 'task1'})
        self.store.complete('n1', {**self.auth(a), 'report': self.report(a)})
        self.store.config['targets']['hook']['command'] = [sys.executable, '-c', 'raise SystemExit(1)']
        deliveries = Deliveries(self.store); deliveries.tick()
        record = self.store.call('status', {'jobId': a['jobId']}, A)
        self.assertEqual(record['state'], 'success'); self.assertEqual(record['deliveries'][0]['state'], 'pending')
        identity = record['deliveries'][0]['id']; self.now += 10
        self.store.config['targets']['hook']['command'] = [sys.executable, '-c', 'pass']
        deliveries.tick(); record = self.store.call('status', {'jobId': a['jobId']}, A)
        self.assertEqual(record['deliveries'][0]['id'], identity)
        self.assertEqual(record['deliveries'][0]['state'], 'delivered')
    def test_options_cannot_override_devices_or_delivery_url(self):
        with self.assertRaises(Error): self.submit(options={'devices': {'phone': {'serial': 'x'}}})
        with self.assertRaises(Error): self.submit(target='unconfigured')
        with self.assertRaises(Error): self.store.call('submit', {**request(), 'url': 'https://bad'}, A)
    def test_paging(self):
        for i in range(3): self.submit(i=str(i))
        first = self.store.call('list', {'limit': 2}, A)
        second = self.store.call('list', {'after': first['nextAfter'], 'limit': 2}, A)
        self.assertEqual(len(first['jobs']) + len(second['jobs']), 3)
    def node(self, client=None): return Node(self.root / 'node', {'endpoint': 'http://127.0.0.1', 'capacity': 2}, client or Direct(self.store))
    def test_node_crash_after_submit_intent_never_replays(self):
        self.submit(); a = self.claim(); n = self.node(); n.accept(a); n.save(a['jobId'], 'submitting')
        n = self.node()
        with patch.object(n, 'submit', side_effect=AssertionError('must not resubmit')): n.process(a['jobId'])
        self.assertEqual(self.store.control('n1', self.auth(a))['state'], 'needs_reconciliation')
    def test_lost_claim_response_is_quarantined(self):
        self.submit(); a = self.claim(); n = self.node(); n.synchronize()
        with patch.object(n, 'submit', side_effect=AssertionError('must not submit recovered unknown lease')): n.process(a['jobId'])
        self.assertEqual(self.store.control('n1', self.auth(a))['state'], 'needs_reconciliation')
    def test_stop_before_node_submission(self):
        self.submit(); a = self.claim(); n = self.node(); n.accept(a)
        self.store.call('stop', {'jobId': a['jobId']}, A)
        with patch.object(n, 'submit', side_effect=AssertionError('must not submit')): n.process(a['jobId'])
        self.assertEqual(self.store.control('n1', self.auth(a))['state'], 'stopped')
    def test_node_full_execute_restart_and_artifact_failure_releases_device(self):
        self.submit(); a = self.claim(); n = self.node(); n.accept(a)
        report = self.report(a); report['cases'][0]['artifacts'] = {'logs': [{'path': str(self.root / 'missing.log')}]}
        with patch.object(n,'submit',return_value={'submitted':True,'taskId':'task1'}),patch.object(n,'cli',return_value={'task':{**report,'status':'running','completed':0}}):
            n.process(a['jobId'])
        self.assertEqual(self.store.call('status',{'jobId':a['jobId']},A)['detail']['progress']['completed'],0)
        with patch.object(n, 'submit', return_value={'submitted': True, 'taskId': 'task1'}), patch.object(n, 'cli', return_value={'task': report}):
            n.process(a['jobId'])
        self.assertEqual(self.store.control('n1', self.auth(a))['state'], 'success')
        self.submit(i='next'); self.assertIsNotNone(self.claim())
        n = self.node()
        with patch.object(n, 'cli', side_effect=AssertionError('retry delivery without rerun')): n.process(a['jobId'])
        record = self.store.call('status', {'jobId': a['jobId']}, A)
        self.assertEqual(record['detail']['artifactState'], 'pending')
    def test_compact_report_excludes_model_context(self):
        self.assertNotIn('results', compact_report({'cases': [{'results': ['secret prompt']} ]})['cases'][0])
    def test_explicit_executor_refusal_releases_without_task(self):
        self.submit(); a = self.claim(); n = self.node(); n.accept(a)
        with patch.object(n, 'submit', return_value={'submitted':False,'errorCode':'INVALID_CASE','error':'bad config'}):
            n.process(a['jobId'])
        status = self.store.call('status', {'jobId':a['jobId']}, A)
        self.assertEqual(status['state'], 'failed'); self.assertIsNone(status['task_id'])
        self.assertIsNone(self.store.assignments('n1')['assignments'][0:1] or None)
    def test_terminal_report_duplicate_case_refused(self):
        a = self.running(); report = self.report(a); report['cases'] *= 2
        with self.assertRaises(Error): self.store.complete('n1', {**self.auth(a),'report':report})
    def test_stopped_report_retains_unexecuted_cases(self):
        self.submit(cases=['c1','c2']); a = self.claim()
        self.store.progress('n1', {**self.auth(a),'taskId':'task1'})
        report = self.report(a,'stopped'); report['total']=2
        report['cases'].append({'caseId':'c2','status':'pending'})
        self.assertEqual(self.store.complete('n1', {**self.auth(a),'report':report})['state'], 'stopped')
    def test_reconcile_checks_device_and_original_case_set(self):
        self.submit(); a=self.claim(); n=self.node(); n.accept(a); n.save(a['jobId'],'needs_reconciliation')
        report=self.report(a); report['devices']={}
        with patch.object(n,'cli',return_value={'task':report}), self.assertRaises(Error):
            n.reconcile(a['jobId'],'task1','operator checked')
        with patch.object(n,'cli',return_value={'task':self.report(a)}):
            self.assertTrue(n.reconcile(a['jobId'],'task1','operator checked')['reconciled'])
    def test_artifact_failures_bounded_without_business_rerun(self):
        self.submit(); a=self.claim(); n=self.node(); n.accept(a)
        report=self.report(a); report['cases'][0]['artifacts']={'log':str(self.root/'missing')}
        with patch.object(n,'submit',return_value={'submitted':True,'taskId':'task1'}), patch.object(n,'cli',return_value={'task':report}):
            n.process(a['jobId'])
        with patch.object(n,'submit',side_effect=AssertionError('must not rerun')):
            for _ in range(7): n.process(a['jobId'])
        status=self.store.call('status',{'jobId':a['jobId']}, A)
        self.assertEqual(status['state'],'success'); self.assertEqual(status['detail']['artifactState'],'failed')
    def test_malformed_start_and_stress_rejected(self):
        for options in ({'startOptions':{'recordGlassesScreen':'true'}},{'stress':{'mode':'rounds','value':True}}):
            with self.assertRaises(Error): self.submit(options=options)

    def test_singleton_lock_does_not_allow_second_process(self):
        with single_instance(self.root/'locks','node'):
            with self.assertRaises(Error):
                with single_instance(self.root/'locks','node'): pass
        with single_instance(self.root/'locks','node'): pass
    def test_queue_limits_preserve_idempotent_retry(self):
        self.store.config['maxQueuedPerPrincipal']=1
        j=self.submit()
        self.assertEqual(self.submit()['id'],j['id'])
        with self.assertRaises(Error): self.submit(i='another')
    def test_platform_target_scope_is_configured_not_guessed(self):
        self.config['targets']['hook']['requiredSourceFields']=['workspaceId']
        self.config['targets']['hook']['sourceEquals']={'workspaceId':'allowed'}
        with self.assertRaises(Error): self.submit(target='hook',source={'workspaceId':'other'})
        self.assertEqual(self.submit(target='hook',source={'workspaceId':'allowed'})['state'],'queued')
    def test_signed_http_delivery_preserves_same_event_id(self):
        import hashlib,hmac,http.server
        received=[]
        class Receiver(http.server.BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_POST(self):
                raw=self.rfile.read(int(self.headers['Content-Length']))
                received.append((raw,dict(self.headers)))
                self.send_response(200); self.end_headers()
        svc=http.server.ThreadingHTTPServer(('127.0.0.1',0),Receiver)
        thread=threading.Thread(target=svc.serve_forever); thread.start()
        os.environ['LAB_TEST_HMAC']='h'*32
        self.config['targets']['hook']={'url':'http://127.0.0.1:'+str(svc.server_port),'tokenEnv':'LAB_TEST_HMAC'}
        try:
            self.submit(target='hook');a=self.claim()
            self.store.progress('n1',{**self.auth(a),'taskId':'task1'})
            self.store.complete('n1',{**self.auth(a),'report':self.report(a)})
            Deliveries(self.store).tick()
            raw,headers=received[0]
            self.assertEqual(headers['X-Lab-Signature'],'sha256='+hmac.new(b'h'*32,raw,hashlib.sha256).hexdigest())
            self.assertEqual(headers['X-Lab-Event-Id'],a['jobId']+':finished')
        finally: svc.shutdown();svc.server_close();thread.join()

    def test_invalid_executor_report_is_explicitly_quarantined(self):
        self.submit();a=self.claim();n=self.node();n.accept(a)
        report=self.report(a);report['devices']={}
        with patch.object(n,'submit',return_value={'submitted':True,'taskId':'task1'}),patch.object(n,'cli',return_value={'task':report}):
            n.process(a['jobId'])
        self.assertEqual(self.store.control('n1',self.auth(a))['state'],'needs_reconciliation')
        self.assertIsNone(self.claim())

class Direct:
    def __init__(self, store): self.store = store
    def call(self, op, args=None, node=False):
        args = args or {}
        if op == 'heartbeat': return self.store.heartbeat('n1', args['capacity'])
        if op == 'assignments': return self.store.assignments('n1')
        return getattr(self.store, op)('n1', args)

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        os.environ['LAB_TEST_USER'] = 'u' * 32; os.environ['LAB_TEST_NODE'] = 'n' * 32; os.environ['LAB_TEST_OTHER'] = 'o' * 32
        config = {'maxArtifactBytes': 64, 'credentials': [{**A, 'tokenEnv': 'LAB_TEST_USER'}, {'id': 'worker', 'role': 'node', 'nodeId': 'n1', 'tokenEnv': 'LAB_TEST_NODE'}, {**B, 'tokenEnv': 'LAB_TEST_OTHER'}]}
        self.store = Store(self.root / 'co', config); self.store.configure_group(group()); self.store.heartbeat('n1', 1)
        self.server = server(self.store, port=0)
        self.thread = threading.Thread(target=self.server.serve_forever); self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)
        self.user = Client(self.url, {'tokenEnv': 'LAB_TEST_USER'}); self.node = Client(self.url, {'tokenEnv': 'LAB_TEST_NODE'})
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.tmp.cleanup()
    def test_http_cli_and_mcp_same_contract(self):
        expected = self.user.call('health')
        messages = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize'}, {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}, {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call', 'params': {'name': 'lab_health', 'arguments': {}}}]
        out = io.StringIO(); mcp(self.user, io.StringIO('\n'.join(map(json.dumps, messages))), out)
        results = list(map(json.loads, out.getvalue().splitlines()))
        self.assertEqual(len(results[1]['result']['tools']), len(OPERATIONS))
        self.assertEqual(json.loads(results[2]['result']['content'][0]['text']), expected)
        config = self.root / 'client.json'; config.write_text(json.dumps({'endpoint': self.url, 'tokenEnv': 'LAB_TEST_USER'}))
        response = subprocess.run([sys.executable, '-m', 'solopi_lab', '--config', str(config), 'call', 'health'], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(response.stdout), expected)
    def test_network_roles_and_artifact_download_owner(self):
        j = self.user.call('submit', request()); a = self.node.call('claim', node=True)['assignment']
        with self.assertRaises(Error): self.node.call('submit', request('x'))
        path = self.root / 'log.txt'; path.write_text('actual log')
        result = self.node.upload(a, path, {'caseId': 'c1'})
        destination = self.root / 'downloaded'
        self.user.download('/v1/artifacts/' + result['artifactId'], destination)
        self.assertEqual(destination.read_bytes(), path.read_bytes())
        with self.assertRaises(Exception): Client(self.url, {'tokenEnv': 'LAB_TEST_OTHER'}).download('/v1/artifacts/' + result['artifactId'], self.root / 'other')
        with self.assertRaises(Exception): self.node.upload(a, path, {'name': '../escape'})
        with self.assertRaises(Exception): self.node.upload(a, path, {'caseId': 'another-case'})
        path.write_text('x' * 100)
        with self.assertRaises(Exception): self.node.upload(a, path, {'caseId': 'c1'})

    def test_real_subprocess_executor_receipt_and_upload_restart(self):
        fixture=Path(__file__).with_name('fake_executor.py')
        executor=self.root/'executor'; executor.mkdir()
        config={'endpoint':self.url,'tokenEnv':'LAB_TEST_NODE','capacity':1,
                'solopiCommand':[sys.executable,str(fixture),str(executor)],'artifactRoots':[str(executor)]}
        j=self.user.call('submit',request())
        a=self.node.call('claim',node=True)['assignment']
        n=Node(self.root/'node',config); n.accept(a); n.process(a['jobId'])
        self.assertEqual(self.user.call('status',{'jobId':j['id']})['task_id'],'fixture-task')
        # Restart with persisted completion pending artifact transfer: no second submit or show.
        n=Node(self.root/'node',config); n.process(a['jobId'])
        artifacts=self.user.call('artifacts',{'jobId':j['id']})['artifacts']
        self.assertEqual(len(artifacts),1)
        destination=self.root/'result.log'; self.user.download(artifacts[0]['downloadPath'],destination)
        self.assertIn('c1',destination.read_text())
        calls=list(map(json.loads,(executor/'calls.jsonl').read_text().splitlines()))
        self.assertEqual(sum(c[:3]==['tools','call','submit_task'] for c in calls),1)
        self.assertEqual(sum(c[:2]==['tasks','show'] for c in calls),1)
    def test_mcp_validation_failure_is_a_tool_error(self):
        out=io.StringIO()
        mcp(self.user,io.StringIO(json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'lab_submit','arguments':{}}})+'\n'),out)
        self.assertTrue(json.loads(out.getvalue())['result']['isError'])
    def test_wrong_node_token_cannot_control_other_node(self):
        self.user.call('submit',request()); a=self.node.call('claim',node=True)['assignment']
        with self.assertRaises(Error): self.user.call('control',{'jobId':a['jobId'],'lease':a['lease']},node=True)

    def test_node_service_lifecycle_with_fake_executor(self):
        import time
        fixture=Path(__file__).with_name('fake_executor.py');executor=self.root/'service-executor';executor.mkdir()
        config={'endpoint':self.url,'tokenEnv':'LAB_TEST_NODE','capacity':1,'pollSeconds':0.05,
                'solopiCommand':[sys.executable,str(fixture),str(executor)],'artifactRoots':[str(executor)]}
        config_file=self.root/'node.json';config_file.write_text(json.dumps(config))
        job=self.user.call('submit',request())
        process=subprocess.Popen([sys.executable,'-m','solopi_lab','--config',str(config_file),'node','--root',str(self.root/'service-state')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                status=self.user.call('status',{'jobId':job['id']})
                if status['state']=='success' and (status['detail'] or {}).get('artifactState')=='delivered': break
                time.sleep(0.05)
            else: self.fail('Node service did not settle the fake execution')
        finally:
            process.terminate()
            try: out,err=process.communicate(timeout=10)
            except subprocess.TimeoutExpired: process.kill();out,err=process.communicate(); self.fail('Node shutdown was not bounded')
        self.assertEqual(process.returncode,0,err)
        self.assertTrue(json.loads(out)['stopped'])
    def test_plain_remote_http_refused(self):
        with self.assertRaises(Error): checked_url('http://example.com')
        with self.assertRaises(Error): checked_url('https://user:secret@example.com')
    def test_http_unknown_arguments_and_wrong_credentials(self):
        with self.assertRaises(Error): self.user.call('health', {'bogus': True})
        with self.assertRaises(Error): Client(self.url, {'tokenEnv': 'LAB_TEST_OTHER'}).call('status', {'jobId': 'missing'})

if __name__ == '__main__': unittest.main()
