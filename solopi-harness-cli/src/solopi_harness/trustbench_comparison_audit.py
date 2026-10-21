"""Audit both comparison arms without pooling their outcomes."""
import argparse
import hashlib
import json
from pathlib import Path

from .trustbench_agent_ledger import evaluate_attempt


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit(direct, harness):
    rows = []
    inputs = []
    policies = []
    for arm, root in [('direct', direct), ('harness', harness)]:
        row = evaluate_attempt(root, 'model', 'Kimi-K3')
        policy = json.loads((root / 'comparison-policy.json').read_text())
        if policy['arm'] != arm:
            raise ValueError('arm mismatch')
        records = json.loads((root / 'model-inputs.json').read_text())
        for record in records:
            encoded = json.dumps(record['modelInput'], ensure_ascii=False, separators=(',', ':'))
            if hashlib.sha256(encoded.encode()).hexdigest() != record['modelInputSha256']:
                raise ValueError('model input hash mismatch')
        receipts = [r['decision']['modelReceipt'] for r in records if 'decision' in r]
        row.update(arm=arm, runDir=str(root), durationMs=row['finishedAt'] - row['startedAt'],
                   modelInputsSha256=sha(root / 'model-inputs.json'),
                   comparisonPolicySha256=sha(root / 'comparison-policy.json'),
                   modelReceipts=receipts)
        rows.append(row)
        inputs.append(records)
        policies.append(policy)
    return {
        'schemaVersion': 'solopi.trustbench.direct-comparison/v1',
        'attempts': rows,
        'sameInitialModelInput': bool(inputs[0] and inputs[1]) and
            inputs[0][0]['modelInputSha256'] == inputs[1][0]['modelInputSha256'],
        'samePrompt': policies[0]['modelPromptSha256'] == policies[1]['modelPromptSha256'],
        'samePlan': rows[0]['planFingerprint'] == rows[1]['planFingerprint'],
        'sameBudget': rows[0]['agentBudget'] == rows[1]['agentBudget'],
        'sameVerifiedDevice': bool(rows[0]['deviceSerial']) and rows[0]['deviceSerial'] == rows[1]['deviceSerial'],
        'sameVerifiedFixture': bool(rows[0]['apkSha256']) and rows[0]['apkSha256'] == rows[1]['apkSha256'],
        'eligibleForReliabilityEstimate': False,
        'superiorityEstablished': False,
        'scope': 'one normal-task paired execution-layer ablation; shared observer and differing action transport',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--direct', type=Path, required=True)
    parser.add_argument('--harness', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.direct, args.harness)
    # Refuse to replace an earlier audit snapshot.
    with args.output.open('x') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({k: v for k, v in result.items() if k != 'attempts'}))


if __name__ == '__main__':
    main()
