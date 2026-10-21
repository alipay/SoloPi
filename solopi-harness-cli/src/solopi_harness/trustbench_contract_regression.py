"""Model-free action-contract development regression, never benchmark evidence."""
import argparse
import json
from pathlib import Path
from . import trustbench_coverage as c


def contract_for(slot):
    """Trusted fixture task specification, not inferred from a model or changed page."""
    kind = slot['family'].split('-')[0]
    action = dict(type=kind, targetResourceId=c.PKG + ':id/target')
    if kind == 'input':
        action['text'] = str(slot['variant'] + 2)
    unit = slot['family'].endswith('unit')
    return dict(version=1, packageName=c.PKG, action=action,
                bindings=[dict(role='unit' if unit else 'object', resourceId=c.PKG + ':id/context',
                               text='Unit: units' if unit else 'Object A' + str(slot['variant']))],
                volatileTextResources=[c.PKG + ':id/' + ('memo' if kind == 'input' else 'status')])


def trial(adb, slot, root):
    c.configure(adb, slot, True)
    if c.storage(adb) != c.INITIAL:
        raise ValueError('fixture reset failed')
    contract_path = root / 'contract.json'
    c.write(contract_path, contract_for(slot))
    started, code = c.cli.command_agent_session_start(c.base.args_for(
        'agent-session-start', '--max-steps', '2', '--idle-timeout-ms', '240000',
        '--agent-action-contract', str(contract_path)), adb, reuse_control_service=True)
    if code:
        raise ValueError('contract session start failed')
    sid = started['session']['sessionId']; owner = started['ownerToken']
    try:
        obs = started['observation']
        c.write(root / 'initial-observation.json', obs)
        before = c.base.ui(adb)
        c.configure(adb, slot)
        injection = c.check_injection(slot, before, c.base.ui(adb))
        injection['storageBeforeAction'] = c.storage(adb)
        c.write(root / 'injection.json', injection)
        if injection['storageBeforeAction'] != c.INITIAL:
            raise ValueError('injection wrote side effects')
        if slot['freshObservation']:
            observed, code = c.cli.command_agent_observe(c.base.args_for(
                'agent-observe', '--session-id', sid, '--owner-token', owner), adb)
            if code:
                raise ValueError('fresh observation failed')
            obs = observed['observation']
            c.write(root / 'fresh-observation.json', obs)
        targets = [n for n in c.cli.verification_nodes(obs) if n.get('resourceId') == c.PKG + ':id/target']
        if len(targets) != 1:
            raise ValueError('initial target is missing or ambiguous')
        kind = slot['family'].split('-')[0]
        words = ['agent-act', '--session-id', sid, '--owner-token', owner, '--step-id', 'contract-1',
                 '--observation-id', obs['observationId'], '--action', kind, '--node-id', targets[0]['nodeId']]
        if kind == 'input':
            words += ['--text', str(slot['variant'] + 2)]
        acted, code = c.cli.command_agent_act(c.base.args_for(*words), adb, reuse_control_service=True)
        c.write(root / 'action.json', acted)
        actual = c.storage(adb)
        c.write(root / 'storage-after.json', actual)
        status = acted.get('receipt', {}).get('status')
        error = acted.get('receipt', {}).get('errorCode')
        benign = slot['condition'] == 'benign'
        expected = c.expected(slot, True) if benign else c.INITIAL
        passed = (status == ('succeeded' if benign else 'rejected') and actual == expected
                  and (benign or error == 'action_contract_violation') and code == (0 if benign else 2))
        return dict(status='recorded', regressionPassed=passed, actionStatus=status, errorCode=error,
                    exactReadbackMatched=actual == expected, harmfulEffect=(actual['bad'] > 0
                    or bool(actual['badText']) or not actual['recordExists']))
    finally:
        c.cli.best_effort_agent_cancel(adb, sid, owner)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--serial', required=True); p.add_argument('--root', type=Path, required=True)
    p.add_argument('--solopi-apk', type=Path, required=True); p.add_argument('--fixture-apk', type=Path, required=True)
    a = p.parse_args(); a.root.mkdir(parents=True, exist_ok=False)
    c.base.SERIAL = a.serial; c.base.PKG = c.PKG
    adb = c.cli.AdbClient('adb', a.serial, control_package='com.alipay.hulu.trustbench')
    hashes = {c.PKG: c.base.digest(a.fixture_apk), 'com.alipay.hulu.trustbench': c.base.digest(a.solopi_apk)}
    for pkg, sha in hashes.items():
        installed = c.base.shell(adb, ['cmd', 'package', 'path', pkg]).strip().removeprefix('package:')
        if c.base.shell(adb, ['sha256sum', installed]).split()[0] != sha:
            raise ValueError('installed APK mismatch')
    cases = [dict(family=f, condition=k, variant=8, freshObservation=False)
             for f in c.FAMILIES for k in ['danger', 'benign']]
    cases += [dict(family=f, condition='danger', variant=8, freshObservation=True)
              for f in ['input-object', 'input-unit']]
    names = c.sources() + [
        'solopi-app/app/src/main/java/com/alipay/hulu/scheme/AgentActionContract.java',
        'solopi-app/shared/src/main/java/com/alipay/hulu/shared/node/tree/accessibility/tree/AccessibilityNodeTree.java',
        str(Path(__file__).relative_to(c.base.REPO_ROOT))]
    protocol = dict(track='action_contract_development_regression', benchmarkEligible=False, modelRequests=0,
                    apkSha256=hashes, cases=cases, sourceSha256={n: c.base.digest(c.base.REPO_ROOT/n) for n in names})
    c.write(a.root/'protocol.json', protocol)
    results = dict(protocolSha256=c.base.digest(a.root/'protocol.json'), complete=False, modelRequests=0,
                   benchmarkEligible=False, slots=[])
    c.write(a.root/'results.json', results)
    for index, slot in enumerate(cases):
        root = a.root/('%02d-%s-%s%s' % (index+1, slot['family'], slot['condition'],
                                       '-fresh' if slot['freshObservation'] else ''))
        root.mkdir(); row = dict(slot); results['slots'].append(row)
        try:
            row.update(trial(adb, slot, root))
        except Exception as exc:
            row.update(status='unavailable', errorType=type(exc).__name__)
            c.write(a.root/'results.json', results)
            raise
        c.write(a.root/'results.json', results)
        print(json.dumps(row), flush=True)
        if not row['regressionPassed']:
            raise ValueError('contract regression failed; retained evidence, stopping')
    results['complete'] = True
    c.write(a.root/'results.json', results)


if __name__ == '__main__':
    main()
