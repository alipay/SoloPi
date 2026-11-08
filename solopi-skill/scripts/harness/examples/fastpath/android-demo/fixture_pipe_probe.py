"""Run destructive-edge probes only against the synthetic reply fixture."""
import argparse
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path

from solopi_harness import desktop_control, solopi_ai, virtual_desktop

PACKAGE = 'com.solopi.fastpath.replyfixture'
PREFIX = 'com.solopi.fastpath.demo:id/'
REPLY = 'Synthetic pipe probe reply'


def click(session, frame, resource):
    matches = [n for n in frame['nodes'] if n.get('resourceId') == PREFIX + resource
               and 'click' in n.get('actions', [])]
    if len(matches) != 1:
        raise RuntimeError('fixture_target_unavailable')
    return session.act({'observationId': frame['observationId'], 'targetId': matches[0]['id'], 'action': 'click'})


def state(session):
    nodes = list(solopi_ai.verification_nodes(session.current))
    inputs = [n for n in nodes if n.get('resourceId') == PREFIX + 'chat_input']
    if len(inputs) != 1:
        raise RuntimeError('fixture_input_unavailable')
    outgoing = {n.get('description') for n in nodes
                if re.fullmatch(r'fixture:message:[A-Za-z0-9-]+:outgoing:text:active', n.get('description') or '')}
    return (inputs[0].get('text'), inputs[0].get('isShowingHintText'), outgoing)


def incoming(session):
    values = []
    for node in solopi_ai.verification_nodes(session.current):
        match = re.fullmatch(r'fixture:message:([A-Za-z0-9-]+):incoming:text:active', node.get('description') or '')
        if match:
            values.append(match.group(1))
    if not values or len(values) != len(set(values)):
        raise RuntimeError('fixture_message_unavailable')
    return values[-1]


def receipt(session, step, wait=15):
    deadline = time.monotonic() + wait
    with solopi_ai.session_from_args(session._args(['agent-status', *session._identity()]), session.adb,
                                     preserve_foreground=True) as transport:
        while time.monotonic() < deadline:
            result = transport.agent('receipt', {'sessionId': session.session_id, 'ownerToken': session.owner_token,
                                                 'stepId': step}, timeout=5)
            if result.get('errorCode') == 'receipt_not_found':
                time.sleep(.25)
                continue
            value = result.get('receipt') if result.get('success') is True else None
            if not isinstance(value, dict) or value.get('stepId') != step:
                raise RuntimeError('receipt_unavailable')
            if value.get('status') != 'accepted':
                return value
            time.sleep(.25)
    return None


def make_frame(session, observation, message, step, send=False):
    return virtual_desktop._fixture_pipe_frame({'sessionId': session.session_id, 'ownerToken': session.owner_token,
        'stepId': step, 'observationId': observation, 'contactId': 'friend-1', 'messageId': message, 'reply': REPLY}, send)


def run(session):
    frame = click(session, session.start(), 'scenario_chat')
    frame = click(session, frame, 'chat_arrival')
    message = incoming(session)
    before = state(session)

    # Code security: test payloads are fixed synthetic data; credentials and frames remain in memory.
    step = 'fixture-' + uuid.uuid4().hex
    truncated = make_frame(session, frame['observationId'], message, step)[:-1]
    if not virtual_desktop._write_fixture_pipe(session.adb, truncated):
        raise RuntimeError('truncated_write_failed')
    if receipt(session, step, wait=3) is not None:
        raise RuntimeError('truncated_receipt_unexpected')
    frame = session.observe()
    if state(session) != before:
        raise RuntimeError('truncated_changed_page')
    print('truncated_no_effect_observed=true', flush=True)

    old = frame['observationId']
    frame = session.observe()
    if old == frame['observationId']:
        raise RuntimeError('observation_not_refreshed')
    step = 'fixture-' + uuid.uuid4().hex
    if not virtual_desktop._write_fixture_pipe(session.adb, make_frame(session, old, message, step)):
        raise RuntimeError('stale_write_unconfirmed')
    rejected = receipt(session, step)
    if (not rejected or rejected.get('status') != 'rejected' or rejected.get('observationId') != old
            or rejected.get('errorCode') != 'fixture_action_rejected'):
        raise RuntimeError('stale_rejection_unconfirmed')
    frame = session.observe()
    if state(session) != before:
        raise RuntimeError('stale_changed_page')
    print('stale_rejected=true', flush=True)

    value = {'observationId': frame['observationId'], 'contactId': 'friend-1', 'messageId': message, 'reply': REPLY}
    frame = session.fixture_reply(value)
    send_observation = frame['observationId']
    value['observationId'] = send_observation
    sent = session.fixture_reply(value, send=True)
    step = sent['receipt']['stepId']
    after = state(session)
    if len(after[2] - before[2]) != 1:
        raise RuntimeError('single_reply_unconfirmed')
    # Code security: repeat only after the same step's successful receipt is confirmed.
    if not virtual_desktop._write_fixture_pipe(session.adb, make_frame(session, send_observation, message, step, True)):
        raise RuntimeError('duplicate_write_unconfirmed')
    repeated = receipt(session, step)
    if not repeated or repeated.get('status') != 'succeeded' or repeated.get('observationId') != send_observation:
        raise RuntimeError('duplicate_receipt_changed')
    time.sleep(1)
    session.observe()
    if state(session) != after:
        raise RuntimeError('duplicate_changed_page')
    print('duplicate_observation_unchanged=true', flush=True)


def cleanup_until_confirmed(session, evidence_directory, read_command=input, sleep=time.sleep):
    """Retain the in-memory owner until cleanup is confirmed; retry only on request."""
    while True:
        try:
            confirmed = session.close().get('cleanupConfirmed') is True
        except (Exception, KeyboardInterrupt):
            confirmed = False
        if confirmed:
            print('cleanup_confirmed=true', flush=True)
            return
        # Code security: keep the session and evidence alive; never replay an action.
        print('cleanup_confirmed=false', flush=True)
        print('evidence_directory=' + str(evidence_directory), flush=True)
        print('Cleanup is unconfirmed. Press Enter to retry cleanup only; keep this process running.', flush=True)
        print('If this process is terminated, its in-memory recovery capability will be lost.', flush=True)
        while True:
            try:
                if read_command() == '':
                    break
                print('Press Enter to retry cleanup only.', flush=True)
            except EOFError:
                # A detached process must not delete evidence or silently lose ownership.
                try:
                    sleep(1)
                except KeyboardInterrupt:
                    pass
            except KeyboardInterrupt:
                print('Cleanup is still unconfirmed; press Enter to retry.', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', args.serial):
        raise SystemExit('invalid_serial')
    config = {'deviceId': args.serial, 'appId': PACKAGE, 'controlPackage': 'com.alipay.hulu.fastpath',
              'controlPort': 23343, 'fixedChecks': []}
    directory = tempfile.mkdtemp(prefix='solopi-fixture-pipe-probe-')
    confirmed = False
    try:
        session = virtual_desktop.VirtualDesktopSession(config, Path(directory) / 'run', desktop_control.cli_args)
        failed = False
        try:
            run(session)
        except Exception:
            failed = True
            print('probe_failed=true', flush=True)
        finally:
            cleanup_until_confirmed(session, directory)
            confirmed = True
        if failed:
            raise SystemExit(1)
    finally:
        if confirmed:
            shutil.rmtree(directory)


if __name__ == '__main__':
    main()
