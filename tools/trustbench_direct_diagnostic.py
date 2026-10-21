"""One disposable-fixture tap; no model calls, no retries, no benchmark score."""
import argparse
import json
import time
from pathlib import Path
from solopi_harness import trustbench_effects_run as e


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--serial',required=True)
    p.add_argument('--artifacts',type=Path,required=True)
    a=p.parse_args()
    a.artifacts.mkdir(parents=True,exist_ok=False)
    e.SERIAL=a.serial
    adb=e.cli.AdbClient('adb',a.serial,control_package='com.alipay.hulu.trustbench')
    write=lambda name,value:e.cli.write_json_file(a.artifacts/name,value)
    result=dict(purpose='one_direct_click_diagnostic',benchmarkEligible=False,
                modelRequests=0,tapCommands=0,serial=a.serial,status='started')
    write('result.json',result)
    sid=owner=None
    def capture(label):
        for service in ['window','input']:
            response=adb.shell(['dumpsys',service],timeout=20)
            encoded=response.stdout.encode()
            write(label+'-'+service+'.json',dict(capturedUnixSeconds=time.time(),
                returnCode=response.returncode,byteLimit=262144,truncated=len(encoded)>262144,
                stdout=encoded[:262144].decode(errors='replace'),stderr=response.stderr[:2048]))
    try:
        frozen=json.loads((e.REPO_ROOT/'solopi-harness-cli/trustbench/effects-protocol-v2.json').read_text())
        hashes={}
        for package,expected in frozen['apkSha256'].items():
            path=e.shell(adb,['cmd','package','path',package]).strip().removeprefix('package:')
            hashes[package]=e.shell(adb,['sha256sum',path]).split()[0]
            if hashes[package]!=expected:raise ValueError('APK differs from diagnostic target')
        write('apk-identity.json',hashes)
        e.configure(adb,'delete',reset=True)
        if e.storage(adb)!=e.INITIAL:raise ValueError('unexpected initial state')
        start,code=e.cli.command_agent_session_start(e.args_for('agent-session-start',
            '--max-steps','2','--max-duration-ms','300000','--idle-timeout-ms','240000'),
            adb,reuse_control_service=True)
        if code:raise ValueError('initial observation unavailable')
        sid=start['session']['sessionId'];owner=start['ownerToken'];obs=start['observation']
        write('observation.json',obs)
        pending=[obs['page']];matches=[]
        while pending:
            n=pending.pop();pending.extend(n.get('children',[]))
            if n.get('resourceId')==e.PKG+':id/preview':matches.append(n)
        if len(matches)!=1:raise ValueError('target not unique')
        b=matches[0]['nodeBound'];x=(b['left']+b['right'])//2;y=(b['top']+b['bottom'])//2
        before=e.ui(adb);write('ui-before.json',before)
        target=e.node(before,'preview')
        if target['bounds']!='[%d,%d][%d,%d]'%(b['left'],b['top'],b['right'],b['bottom']):
            raise ValueError('target moved')
        if target.get('enabled')!='true' or target.get('clickable')!='true':raise ValueError('target disabled')
        write('storage-before.json',e.storage(adb))
        capture('before')
        focus=adb.foreground_component()
        if focus not in {e.PKG+'/.MainActivity',e.PKG+'/'+e.PKG+'.MainActivity'}:
            raise ValueError('foreign foreground')
        result['tapCommands']=1
        write('result.json',result)
        started=time.time()
        receipt=adb.shell(['input','tap',str(x),str(y)],timeout=30)
        write('tap.json',dict(command=['input','tap',str(x),str(y)],foregroundBefore=focus,
              startedUnixSeconds=started,finishedUnixSeconds=time.time(),returnCode=receipt.returncode,
              stdout=receipt.stdout[:2048],stderr=receipt.stderr[:2048]))
        time.sleep(1)
        after=e.storage(adb);write('storage-after-1s.json',after)
        time.sleep(2)
        later=e.storage(adb);write('storage-after-3s.json',later)
        write('ui-after.json',e.ui(adb));capture('after')
        result.update(status='completed',adbReturnCode=receipt.returncode,
            desiredEffectAt1s=after==e.expected('delete',False,True),
            desiredEffectAt3s=later==e.expected('delete',False,True),
            timingNote='Extra dumpsys collection changes timing; not a replay or replacement of prior failure')
    except Exception as exc:
        result.update(status='unavailable',errorType=type(exc).__name__,error=str(exc)[:300])
    finally:
        if sid and owner:e.cli.best_effort_agent_cancel(adb,sid,owner)
        write('result.json',result)
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':main()
