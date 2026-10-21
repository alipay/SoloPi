"""Continue an audited prefix without modifying frozen engine or original evidence."""
import argparse
import json
import os
import shutil
import time
from pathlib import Path
from solopi_harness import trustbench_effects_run as e
from solopi_harness.trustbench_effects_v2_audit import audit, evidence_dir


def checked_prefix(source, protocol, index):
    report=audit(source,protocol,index)
    result=json.loads((source/'results.json').read_text())
    count=report['validSlots']
    if count==0 or count>=24 or count%2:
        raise ValueError('requires a nonempty incomplete paired prefix')
    if any(s.get('status')!='recorded' for s in result['slots'][:count]):
        raise ValueError('recorded slots must be a prefix')
    if any('status' in s for s in result['slots'][count:]):
        raise ValueError('refusing to retry attempted slots')
    if result.get('stopped') or result.get('setupFailure'):
        raise ValueError('refusing to continue failed setup')
    return result,count


def main():
    if not __debug__:raise RuntimeError('assertions must remain enabled')
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['source','protocol','expected-index','artifacts']:
        p.add_argument('--'+key,type=Path,required=True)
    p.add_argument('--confirm-disposable-device',action='store_true',required=True)
    a=p.parse_args()
    result,count=checked_prefix(a.source,a.protocol,a.expected_index)
    protocol=json.loads(a.protocol.read_text());e.validate_config(protocol)
    for name,h in protocol['sourceSha256'].items():
        if e.digest(e.REPO_ROOT/name)!=h:raise ValueError('frozen source changed: '+name)
    if not os.environ.get('TRUSTBENCH_MODEL_API_KEY'):raise ValueError('missing model credential')
    a.artifacts.mkdir(parents=True,exist_ok=False)
    shutil.copy2(a.protocol,a.artifacts/'protocol.json')
    shutil.copy2(a.source/'results.json',a.artifacts/'source-results.json')
    shutil.copy2(a.expected_index,a.artifacts/'source-audit.json')
    for i,s in enumerate(result['slots'][:count],1):
        src=evidence_dir(a.source,s,i)
        shutil.copytree(src,a.artifacts/src.name)
    # Prove carried bytes unchanged before any device or model operation.
    shutil.copy2(a.source/'results.json',a.artifacts/'results.json')
    audit(a.artifacts,a.protocol,a.expected_index)
    result.update(runPurpose='explicit_remaining_slots_continuation',maxSlots=24)
    result.pop('plannedSmokeLimitReached',None)
    result['continuation']=dict(carriedSlots=list(range(1,count+1)),
        requestedSlots=list(range(count+1,25)),sourceResultsSha256=e.digest(a.source/'results.json'),
        sourceAuditSha256=e.digest(a.expected_index),driverSha256=e.digest(__file__),
        protocolUnchanged=True,automaticRetries=0,startedUnixSeconds=time.time())
    save=lambda:e.cli.write_json_file(a.artifacts/'results.json',result)
    save();e.SERIAL=protocol['device'];e.CONFIG=protocol
    try:
        adb=e.cli.AdbClient('adb',e.SERIAL,control_package='com.alipay.hulu.trustbench')
        for package,h in protocol['apkSha256'].items():
            path=e.shell(adb,['cmd','package','path',package]).strip().removeprefix('package:')
            if e.shell(adb,['sha256sum',path]).split()[0]!=h:raise ValueError('installed APK mismatch')
    except Exception as exc:
        result.update(stopped=True,setupFailure=type(exc).__name__);save();raise SystemExit(1)
    last=result['slots'][count-1]
    started=json.loads((evidence_dir(a.artifacts,last,count)/'request-start.json').read_text())['startUnixSeconds']
    delay=max(0,60-(time.time()-started))
    if delay>0:time.sleep(delay)
    pacer=e.RequestPacer(60)
    for i in range(count,24):
        slot=result['slots'][i]
        directory=a.artifacts/('%02d-%s-%s-%s'%(i+1,slot['scene'],'changed' if slot['inject'] else 'unchanged',slot['arm']))
        directory.mkdir();slot.update(status='running',runDir=directory.name);save()
        print(json.dumps(dict(slot=i+1,**slot)),flush=True)
        try:
            slot.update(e.trial(adb,slot,directory,pacer),status='recorded')
            if not slot['storageConsistent']:result.update(stopped=True,stopReason='storage_mismatch')
        except Exception as exc:
            slot.update(status='unavailable',errorType=type(exc).__name__,httpStatus=getattr(exc,'code',None))
            result['stopped']=True
        save();print(json.dumps(dict(slot=i+1,**slot)),flush=True)
        if result.get('stopped'):raise SystemExit(1)
    print(json.dumps(dict(completedNewSlots=24-count,carriedSlots=count)),flush=True)


if __name__=='__main__':main()
