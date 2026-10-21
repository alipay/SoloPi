import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from solopi_harness import trustbench_effects_run as runner
from solopi_harness import trustbench_effects_v2 as historical


class PortableRunnerTests(unittest.TestCase):
    def protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory)/'fixture.apk'
            apk.write_bytes(b'offline test only, not an APK')
            with patch.object(runner.cli, 'AdbClient', side_effect=AssertionError('device forbidden')):
                return runner.freeze('my-new-group','my-test-device',
                    'https://example.invalid/v1/chat/completions','my-model',apk,apk)

    def test_offline_freeze_and_source_inventory(self):
        p = self.protocol()
        self.assertEqual(p['minRequestIntervalMs'],60000)
        self.assertEqual(p['preflight'],'not_run; new environment requires on-device validation')
        self.assertEqual(p['schedule'],historical.schedule())
        self.assertEqual(p['systemPrompt'],historical.PROMPT)
        self.assertEqual(p['apkSha256'][runner.PKG],runner.hashlib.sha256(b'offline test only, not an APK').hexdigest())
        for name,digest in p['sourceSha256'].items():
            self.assertEqual(runner.digest(runner.REPO_ROOT/name),digest)

    def test_invalid_endpoint_and_old_identity(self):
        p=self.protocol()
        for endpoint in ['http://example.invalid','https://key@example.invalid',
                         'https://example.invalid?key=secret','https://example.invalid/#secret']:
            q=copy.deepcopy(p);q['endpoint']=endpoint
            with self.assertRaises(ValueError):runner.validate_config(q)
        for group in ['effects-safety-v1','effects-safety-v2']:
            q=copy.deepcopy(p);q['protocolId']=group
            with self.assertRaises(ValueError):runner.validate_config(q)

    def test_budget_schedule_and_prompt_cannot_drift(self):
        for key,value in [('minRequestIntervalMs',30000),('schedule',[]),('systemPrompt','other'),('maxOutputTokens',1024)]:
            p=self.protocol();p[key]=value
            with self.assertRaises(ValueError):runner.validate_config(p)

    def test_device_must_be_explicitly_disposable(self):
        with self.assertRaises(SystemExit):
            runner.build_parser().parse_args(['run','--protocol','p.json','--artifacts','runs'])

    def test_smoke_limit_is_explicit_and_bounded(self):
        args=['run','--protocol','p.json','--artifacts','runs','--confirm-disposable-device']
        self.assertEqual(runner.build_parser().parse_args(args).max_slots,24)
        self.assertEqual(runner.build_parser().parse_args(args+['--max-slots','4']).max_slots,4)
        for value in ['0','25']:
            with self.assertRaises(SystemExit):
                runner.build_parser().parse_args(args+['--max-slots',value])

    def test_oracles_unchanged(self):
        for scene in ['delete','stock']:
            for injected in [False,True]:
                for executed in [False,True]:
                    self.assertEqual(runner.expected(scene,injected,executed),historical.expected(scene,injected,executed))

    def test_redirects_never_forward_credentials(self):
        with self.assertRaises(ValueError):
            runner.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://elsewhere.invalid')

    def test_setup_failure_preserves_pending_slots_and_nonzero_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);protocol=root/'protocol.json';output=root/'run'
            protocol.write_text(json.dumps(self.protocol()))
            argv=['effects','run','--protocol',str(protocol),'--artifacts',str(output),
                  '--confirm-disposable-device']
            with patch('sys.argv',argv), patch.dict(runner.os.environ,{'TRUSTBENCH_MODEL_API_KEY':'test-only'}), \
                 patch.object(runner.cli,'AdbClient',side_effect=RuntimeError('simulated missing device')):
                with self.assertRaises(SystemExit) as error:runner.main()
            self.assertEqual(error.exception.code,1)
            result=json.loads((output/'results.json').read_text())
            self.assertEqual(result['setupFailure'],'RuntimeError')
            self.assertEqual(len(result['slots']),24)
            self.assertTrue(all('status' not in slot for slot in result['slots']))

    def test_freeze_cannot_overwrite_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);apk=root/'fixture.apk';apk.write_bytes(b'fake')
            output=root/'protocol.json';output.write_text('do not overwrite')
            argv=['effects','freeze','--protocol-id','new-group','--serial','test-device',
                  '--endpoint','https://example.invalid/v1/chat/completions','--model','test-model',
                  '--fixture-apk',str(apk),'--solopi-apk',str(apk),'--output',str(output)]
            with patch('sys.argv',argv),self.assertRaises(FileExistsError):runner.main()
            self.assertEqual(output.read_text(),'do not overwrite')

    def test_model_uses_configured_endpoint_identity_and_pacer(self):
        with tempfile.TemporaryDirectory() as directory:
            config={'model':'custom-model','endpoint':'https://example.invalid/v1/chat/completions'}
            response=MagicMock()
            response.__enter__.return_value.read.return_value=json.dumps({
                'model':'custom-model','id':'test-response','choices':[
                    {'finish_reason':'stop','message':{'content':'{}'}}]}).encode()
            opener=MagicMock();opener.open.return_value=response
            pacer=MagicMock();pacer.wait.return_value=0
            with patch.object(runner,'CONFIG',config),patch.object(runner,'model_input',return_value={}), \
                 patch.object(runner,'parse_decision',return_value={'type':'blocked'}), \
                 patch.object(runner.urllib.request,'build_opener',return_value=opener), \
                 patch.dict(runner.os.environ,{'TRUSTBENCH_MODEL_API_KEY':'test-only'}):
                decision=runner.model({},pacer,Path(directory))
            request=opener.open.call_args.args[0]
            self.assertEqual(request.full_url,config['endpoint'])
            self.assertEqual(json.loads(request.data)['model'],'custom-model')
            self.assertEqual(decision['modelReceipt']['minRequestIntervalMs'],60000)
            pacer.wait.assert_called_once_with(120)
            self.assertNotIn('test-only',(Path(directory)/'decision.json').read_text())
