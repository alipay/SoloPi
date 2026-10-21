"""Read-only, explicit-index pilot audit. Never pools independent policy groups."""

import argparse
import json
from pathlib import Path

from .trustbench_agent_ledger import evaluate_manifest, evaluate_attempt, digest


def audit(index_path):
    index_path = Path(index_path)
    index = json.loads(index_path.read_text())
    groups, seen = [], set()
    for name in index['manifests']:
        path = index_path.parent / name
        result = evaluate_manifest(path)
        for row in result['attempts']:
            if row['runId'] in seen:
                raise ValueError('attempt repeated across groups: ' + row['runId'])
            seen.add(row['runId'])
        groups.append({'manifest': name, 'manifestSha256': digest(path), **result})
    probes = []
    for item in index['oracleProbes']:
        run = Path(item['runDir'])
        row = evaluate_attempt(run, 'control')
        report = json.loads((run / 'report.json').read_text())
        scenario = report['scenarios'][0]
        checks = {c['checkpointId']: c for c in scenario['checkpoints']}
        if item['kind'] == 'positive':
            accepted = row['outcome'] == 'passed'
        elif item['kind'] == 'false_done':
            accepted = (
                row['outcome'] == 'task_failed' and row['agentDone']
                and row['actions'] == 0 and row['modelDecisionCount'] == 0
                and checks['list-is-empty']['status'] == 'passed'
                and scenario.get('failure', {}).get('category') == 'oracle_mismatch'
                and any(checks[k]['status'] == 'failed'
                        for k in ('saved-title-matches', 'saved-body-matches'))
            )
        else:
            raise ValueError('unknown oracle probe')
        if not accepted:
            raise ValueError('oracle probe did not meet contract: ' + run.name)
        probes.append({'kind': item['kind'], 'contractPassed': accepted, 'attempt': row})
    current = next(g for g in groups if g['manifest'] == index['currentManifest'])
    paired = all(any(r['track'] == track and r['outcome'] == 'passed'
                     for r in current['attempts']) for track in ('control', 'model'))
    if not paired or {p['kind'] for p in probes} != {'positive', 'false_done'}:
        raise ValueError('pilot closure incomplete')
    passing = [r for r in current['attempts'] if r['outcome'] == 'passed']
    identities = {(r['planFingerprint'], r['deviceSerial'], r['apkSha256'],
                   json.dumps(r['agentBudget'], sort_keys=True)) for r in passing}
    if len(identities) != 1:
        raise ValueError('current control/model conditions differ')
    return {'schemaVersion': 'solopi.trustbench.pilot-closure/v1',
            'indexSha256': digest(index_path), 'pilotClosurePassed': True,
            'eligibleForReliabilityEstimate': False, 'eligibleForModelRanking': False,
            'groups': groups, 'oracleProbes': probes,
            'limitations': ['single model and small fixture task set',
                            'new holdout seed, not independently authored tasks',
                            'historical evidence_invalid attempt retained',
                            'local storage truth, not external backend attestation',
                            'no pooled success rate or inferred monetary cost']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.index), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
