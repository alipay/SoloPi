"""Fixture-only paired execution ablation; never an unrestricted ADB agent."""

import argparse
import hashlib
import json
import re
import time
from pathlib import Path

from . import solopi_ai as cli
from .trustbench_model_bridge import model_input, NOTES_PACKAGE, NOTES_SYSTEM_PROMPT


PLAN = '7b9c96b7c9fbcffeba5d1c2449340f09c77cfbbbd6996e1bc03d1e6a0af6a2b6'
ALLOWED_IDS = {'new_note_button', 'title_input', 'body_input', 'save_button'}


def observed_target(observation, node_id, action):
    pending, matches = [observation['page']], []
    while pending:
        node = pending.pop()
        if node.get('nodeId') == node_id:
            matches.append(node)
        pending.extend(node.get('children', []))
    if len(matches) != 1:
        raise cli.CliError('direct target must uniquely match observed node', 3)
    node = matches[0]
    flag = 'isEditable' if action == 'input' else 'isClickable'
    if (node.get('packageName') != NOTES_PACKAGE or not node.get('visible')
            or not node.get(flag) or node.get('resourceId') not in
            {NOTES_PACKAGE + ':id/' + x for x in ALLOWED_IDS}):
        raise cli.CliError('direct action is outside test-fixture allowlist', 3)
    b = node['nodeBound']
    if not (0 <= b['left'] < b['right'] and 0 <= b['top'] < b['bottom']):
        raise cli.CliError('invalid observed bounds', 3)
    return node, ((b['left'] + b['right']) // 2, (b['top'] + b['bottom']) // 2)


def input_argument(text):
    # Both frozen seeds use this alphabet. Never pass model shell syntax to adb.
    if not isinstance(text, str) or not re.fullmatch(r'[A-Za-z0-9 ]{1,200}', text):
        raise cli.CliError('comparison input requires ASCII letters/digits/spaces', 3)
    return text.replace(' ', '%s')


class RecordingProvider:
    def __init__(self, provider, artifact_root):
        self.provider, self.artifact_root = provider, artifact_root
        self.records = []

    def decide(self, context):
        supplied = model_input(context, NOTES_PACKAGE)
        encoded = json.dumps(supplied, ensure_ascii=False, separators=(',', ':'))
        item = {'stepIndex': context['stepIndex'],
                'modelInputSha256': hashlib.sha256(encoded.encode()).hexdigest(),
                'modelInput': supplied}
        self.records.append(item)
        cli.write_json_file(self.artifact_root / 'model-inputs.json', self.records)
        decision = self.provider.decide(context)
        item['decision'] = decision
        cli.write_json_file(self.artifact_root / 'model-inputs.json', self.records)
        return decision


class ComparisonAdapter(cli.SoloPiVerificationAdapter):
    mode = 'harness'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.decision_provider:
            self.decision_provider = RecordingProvider(self.decision_provider, self.artifact_root)
        self.action_transport = 'direct_adb' if self.mode == 'direct' else 'solopi_guarded'

    def _execute_dynamic(self, segment, scenario, decisions, *args, **kwargs):
        if scenario['targetAppPackage'] != NOTES_PACKAGE:
            raise cli.CliError('comparison only supports disposable Notes fixture', 3)
        self.started = time.monotonic()
        self.last_action = self.started
        self.count = self.repeats = self.no_progress = 0
        self.previous_action = None
        self.budget = segment['dynamicStep']['budget']
        result = super()._execute_dynamic(segment, scenario, decisions, *args, **kwargs)
        if (time.monotonic() - self.started) * 1000 > self.budget['maxDurationMs']:
            result.update(state='not_tested', reason='comparison_total_budget_exhausted')
        return result

    def _perform_agent_action(self, args, observation):
        now = time.monotonic()
        if (self.count >= self.budget['maxSteps']
                or (now - self.started) * 1000 > self.budget['maxDurationMs']
                or (now - self.last_action) * 1000 > self.budget['idleTimeoutMs']):
            raise cli.CliError('comparison budget exhausted', 3)
        key = (args.action, args.node_id, args.text)
        self.repeats = self.repeats + 1 if key == self.previous_action else 1
        if self.repeats > self.budget['maxRepeatedActions']:
            raise cli.CliError('comparison repeated-action budget exhausted', 3)
        self.previous_action = key
        if args.action not in {'click', 'input'}:
            raise cli.CliError('comparison supports only typed click/input', 3)
        # Same fixture/action/input envelope for both arms. No current-page
        # signature comparison here: that is the guarded arm's treatment.
        node, (x, y) = observed_target(observation, args.node_id, args.action)
        text = input_argument(args.text) if args.action == 'input' else None
        if self.adb.foreground_component() not in {
                NOTES_PACKAGE + '/.MainActivity', NOTES_PACKAGE + '/' + NOTES_PACKAGE + '.MainActivity'}:
            raise cli.CliError('comparison refuses actions outside fixture foreground', 3)
        if self.mode == 'harness':
            result, code = super()._perform_agent_action(args, observation)
        else:
            commands = [['input', 'tap', str(x), str(y)]]
            if args.action == 'input':
                commands += [['input', 'keycombination', '113', '29'],
                             ['input', 'text', text]]
            for command in commands:
                response = self.adb.shell(command, timeout=15)
                if response.returncode != 0:
                    raise cli.CliError('direct fixture input transport failed', 3)
            time.sleep(0.5)
            with cli.session_from_args(self.args, self.adb, launch_app=False) as session:
                observed = session.agent('observe', {'sessionId': args.session_id,
                                                     'ownerToken': args.owner_token})
            settled = observed.get('observation')
            if observed.get('success') is not True or not isinstance(settled, dict):
                raise cli.CliError('direct post-action observation unavailable', 3)
            # Explicit host execution record, never presented as a device guard receipt.
            result, code = {'success': True, 'receipt': {
                'source': 'host_direct_adb', 'guardChecked': False,
                'stepId': args.step_id, 'observationId': args.observation_id,
                'status': 'succeeded', 'targetResourceId': node['resourceId'],
                'settledObservation': settled}}, 0
        self.count += 1
        self.last_action = time.monotonic()
        settled = result.get('receipt', {}).get('settledObservation', {})
        self.no_progress = self.no_progress + 1 if settled.get('signature') == observation.get('signature') else 0
        if self.no_progress >= self.budget['maxNoProgressSteps']:
            raise cli.CliError('comparison no-progress budget exhausted', 3)
        return result, code


def main(adapter_base=ComparisonAdapter):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arm', required=True, choices=('direct', 'harness'))
    experiment, remaining = parser.parse_known_args()
    args = cli.build_parser().parse_args(remaining)
    if args.command != 'verify-run':
        parser.error('only verify-run is admitted')
    plan = cli.load_json_file(Path(args.plan))
    if args.command != 'verify-run' or plan.get('planFingerprint') != PLAN:
        parser.error('only the frozen long-budget Notes plan is admitted')
    if args.decision_provider != 'cloud' or args.agent_decisions:
        parser.error('both arms require the same live cloud decision provider')
    if Path(args.artifacts).exists():
        parser.error('comparison output must be a new directory')
    adapter = type('SelectedComparisonAdapter', (adapter_base,), {'mode': experiment.arm})
    adb = cli.AdbClient(args.adb, args.serial, control_package=args.package)
    try:
        result, code = cli.command_verify_run(args, adb, adapter_class=adapter)
    except cli.CliError as exc:
        result, code = {'success': False, 'error': str(exc)}, exc.exit_code
    root = Path(args.artifacts)
    if root.exists() and (root / 'report.json').exists():
        cli.write_json_file(root / 'comparison-policy.json', {
            'arm': experiment.arm, 'planFingerprint': PLAN,
            'observer': 'shared SoloPi read-only accessibility observer',
            'modelPromptSha256': hashlib.sha256(NOTES_SYSTEM_PROMPT.encode()).hexdigest(),
            'actionTransport': adapter.mode, 'independentJudge': 'same UI/storage audit',
            'limitations': ['execution-layer ablation, not a SoloPi-free agent',
                            'ADB input transport differs from guarded execution',
                            'fixture-only ASCII text and click/input envelope']})
    cli.emit(result, args.pretty)
    return code


if __name__ == '__main__':
    raise SystemExit(main())
