"""Model-free development regression; never score this as model benchmark data."""
import argparse
from pathlib import Path
from . import trustbench_coverage as c


def scripted(context, pacer, root):
    nodes=[n for n in c.model_input(context)['visibleNodes'] if n.get('resourceId')==c.PKG+':id/target']
    if len(nodes)!=1:raise ValueError('missing or ambiguous scripted target')
    n=nodes[0]
    action=dict(type=context['allowedActions'][0],selector={k:n[k] for k in ['resourceId','className','packageName']})
    if action['type']=='input':action['text']='8'
    decision=dict(type='act',action=action,source='scripted_development_control',modelRequests=0)
    c.write(root/'decision.json',decision)
    return decision


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--serial',required=True);p.add_argument('--root',type=Path,required=True)
    p.add_argument('--solopi-apk',type=Path,required=True);p.add_argument('--fixture-apk',type=Path,required=True)
    a=p.parse_args();a.root.mkdir(parents=True,exist_ok=False)
    c.base.SERIAL=a.serial;c.base.PKG=c.PKG
    adb=c.cli.AdbClient('adb',a.serial,control_package='com.alipay.hulu.trustbench')
    hashes={c.PKG:c.base.digest(a.fixture_apk),'com.alipay.hulu.trustbench':c.base.digest(a.solopi_apk)}
    for pkg,h in hashes.items():
        path=c.base.shell(adb,['cmd','package','path',pkg]).strip().removeprefix('package:')
        if c.base.shell(adb,['sha256sum',path]).split()[0]!=h:raise ValueError('installed APK mismatch')
    result=dict(track='scripted_development_regression',modelRequests=0,benchmarkEligible=False,
                apkSha256=hashes,sourceSha256={n:c.base.digest(c.base.REPO_ROOT/n) for n in c.sources()},slots=[])
    c.write(a.root/'results.json',result)
    c.model=scripted
    for family in c.FAMILIES:
        for condition in ['danger','benign']:
            slot=dict(family=family,condition=condition,variant=6,arm='harness')
            root=a.root/(family+'-'+condition);root.mkdir()
            result['slots'].append(slot)
            try:
                slot.update(c.trial(adb,slot,root,None))
                slot['guardRegressionPassed']=slot['actionStatus']=='rejected' and slot['noEffect'] and not slot['harmfulEffect'] and slot['storageValid']
            except Exception as exc:
                slot.update(status='unavailable',errorType=type(exc).__name__)
                c.write(a.root/'results.json',result)
                raise
            c.write(a.root/'results.json',result)
            print(slot,flush=True)


if __name__=='__main__':main()
