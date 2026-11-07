"""Private desktop-side owner for one Android virtual Agent session."""
from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import re
import secrets
import time
import uuid
from collections import Counter
from pathlib import Path

from . import solopi_ai
from .native_runtime import NativeExecutionError as Error
from .strict_png import validate_png
from . import verification_engine


class _StartTrackingAdb(solopi_ai.AdbClient):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_dispatched = False

    def invoke_scheme(self, action, params, *args, **kwargs):
        if action == 'agent' and params.get('type') == 'start':
            # Code security: after dispatch begins, failure cannot prove the device did nothing.
            self.start_dispatched = True
        return super().invoke_scheme(action, params, *args, **kwargs)


def _visible_oracle_result(oracle, observation, target_package):
    """Apply the existing UI oracle only to a uniquely visible, unobscured target."""
    nodes = list(solopi_ai.verification_nodes(observation))
    matches = [node for node in nodes if all(node.get(key) == value for key, value in oracle['selector'].items())]
    if not matches: return 'not_tested', 'target_not_observed', None
    if len(matches) != 1: return 'not_tested', 'ambiguous_selector', None
    target = matches[0]
    reason = _visible_node_reason(target, observation, target_package)
    if reason: return 'not_tested', reason, None
    # Code security: only the verified same-session observation reaches the fixed Judge.
    return verification_engine._evaluate_ui_oracle(oracle, observation)


def _visible_node_reason(target, observation, target_package):
    """Conservatively check whether a node is readable in the observed window."""
    if (target.get('packageName') != target_package or target.get('isVisibleToUser') is not True
            or target.get('isPassword') is not False):
        return 'target_not_visibly_observable'

    def rect(value):
        if not isinstance(value, dict): return None
        raw = [value.get(key) for key in ('left', 'top', 'right', 'bottom')]
        if any(type(x) is not int for x in raw) or raw[0] < 0 or raw[1] < 0 or raw[2] <= raw[0] or raw[3] <= raw[1]:
            return None
        return raw

    bounds = rect(target.get('nodeBound'))
    windows = observation.get('windows')
    width, height = observation.get('screenWidth'), observation.get('screenHeight')
    if (bounds is None or not isinstance(windows, list) or type(width) is not int or type(height) is not int
            or width <= 0 or height <= 0 or bounds[2] > width or bounds[3] > height):
        return 'target_geometry_unknown'
    active = [w for w in windows if isinstance(w, dict) and w.get('id') == observation.get('windowId')]
    if len(active) != 1 or type(active[0].get('layer')) is not int:
        return 'window_unavailable'
    window = rect(active[0].get('bounds'))
    if window is None or window[2] > width or window[3] > height or not (window[0] <= bounds[0] < bounds[2] <= window[2]
                              and window[1] <= bounds[1] < bounds[3] <= window[3]):
        return 'target_geometry_unknown'
    for other in windows:
        if not isinstance(other, dict) or type(other.get('layer')) is not int or rect(other.get('bounds')) is None:
            return 'window_geometry_unknown'
        if other.get('id') == active[0].get('id'): continue
        ob = rect(other['bounds'])
        if ob[2] > width or ob[3] > height: return 'window_geometry_unknown'
        if (other['layer'] >= active[0]['layer'] and bounds[0] < ob[2] and bounds[2] > ob[0]
                and bounds[1] < ob[3] and bounds[3] > ob[1]):
            return 'target_occluded'
    return None


class VirtualDesktopSession:
    def __init__(self, config, root, cli_args, owner_token=None):
        self.config = config
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=False, mode=0o700)
        self.cli_args = cli_args
        self.adb = _StartTrackingAdb(requested_serial=config["deviceId"], control_package=config["controlPackage"],
                                      executable=os.environ.get("ADB", "adb"))
        self.session_id = self.current = None
        self.owner_token = owner_token
        self.display_id = None
        self.targets = {}
        self.action_outcome_unknown = False
        # Code security: freeze checks from the trusted desktop configuration before any action.
        self.checks = tuple({'type': 'ui', 'selector': {c['selectorKey']: c['selectorValue']},
                             'field': 'text', 'operator': c['operator'], 'expected': c['expected']}
                            for c in config.get('fixedChecks', []))
        self.evidence = []
        self.events = []
        self.judgement = None
        self.started_at = time.monotonic()
        self.judge_duration_ms = None
        self.start_duration_ms = None
        self.cleanup_duration_ms = None

    def _args(self, args):
        return self.cli_args(self.config, args)

    def _identity(self):
        if not self.session_id or not self.owner_token:
            raise Error("no_virtual_session")
        return ["--session-id", self.session_id, "--owner-token", self.owner_token]

    def start(self):
        start_started = time.monotonic()
        self.adb.connect()
        health, code = solopi_ai.command_doctor(self._args(["doctor"]), self.adb)
        if code or health.get("success") is not True:
            raise Error("android_setup_required")
        # Code security: target and screen are frozen for this session; no foreground launch is used.
        # Keep the generated owner capability even if startup is interrupted after dispatch.
        # Code security: owner capabilities use a cryptographically secure random source.
        self.owner_token = self.owner_token or secrets.token_hex(32)
        result, code = solopi_ai.command_agent_session_start(self._args([
            "agent-session-start", "--screen-mode", "virtual", "--target-package", self.config["appId"],
            "--max-steps", "200", "--max-duration-ms", "1800000", "--idle-timeout-ms", "300000",
            "--max-repeated-actions", "20", "--max-no-progress-steps", "20", "--ack-timeout", "45",
            "--owner-token", self.owner_token,
        ]), self.adb)
        state = result.get("session") or {}
        if isinstance(state.get("sessionId"), str): self.session_id = state["sessionId"]
        if code or result.get("success") is not True:
            raise Error(state.get("terminalReason") or result.get("errorCode") or "virtual_start_failed")
        if not self.session_id or result.get("ownerToken") != self.owner_token:
            raise Error("virtual_start_identity_unconfirmed")
        frame = self._initial_frame(result["observation"])
        self.start_duration_ms = round((time.monotonic() - start_started) * 1000)
        # Persist an explicitly unconfirmed cleanup state before returning ownership to the desktop.
        frame['pendingReport'] = self._write_report('pending')
        return frame

    def _initial_frame(self, observation):
        frame = self._frame(observation)
        refreshes = 0
        while refreshes < 2:
            freshness = frame.get('ocrFreshness')
            stale = (frame.get('ocrError') in {'stale_observation', 'stale_frame'}
                     or isinstance(freshness, str) and freshness != 'current')
            if not stale: break
            # Bounded read-only recapture may recover cold OCR; it never repeats an action.
            # observe() invalidates the previous targets even if the refresh fails.
            frame = self.observe()
            refreshes += 1
        if refreshes:
            frame['ocrInitialRefresh'] = True
            frame['ocrInitialRefreshCount'] = refreshes
        return frame

    def _frame(self, observation):
        # Code security: a failed refresh must never leave an older observation actionable.
        self.current, self.targets = None, {}
        if (not isinstance(observation, dict) or observation.get("screenMode") != "virtual"
                or not isinstance(observation.get("displayId"), int) or observation["displayId"] <= 0
                or (self.display_id is not None and observation["displayId"] != self.display_id)
                or not isinstance(observation.get("page"), dict)
                or not isinstance(observation.get("observationId"), str)
                or observation["page"].get("packageName") != self.config["appId"]):
            raise Error("virtual_observation_identity_mismatch")
        self.display_id = observation['displayId']
        remote = observation.get("screenshotPath")
        expected = observation.get("screenshotSha256")
        # Only the device-generated file for this exact session can become a preview.
        suffix = r"/agent-sessions/" + re.escape(self.session_id) + r"/virtual-observation-[0-9a-f-]+\.png\Z"
        if (not isinstance(remote, str) or not remote.startswith("/storage/emulated/0/")
                or ".." in remote.split("/") or re.search(suffix, remote) is None
                or not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected)):
            raise Error("virtual_screenshot_identity_mismatch")
        local = self.root / (uuid.uuid4().hex + ".png")
        pull_started = time.monotonic()
        self.adb.pull(remote, local)
        raw = local.read_bytes()
        dimensions = validate_png(raw)
        if (type(observation.get('screenWidth')) is not int or type(observation.get('screenHeight')) is not int
                or dimensions != (observation['screenWidth'], observation['screenHeight'])):
            local.unlink(missing_ok=True)
            raise Error('virtual_screenshot_geometry_mismatch')
        if hashlib.sha256(raw).hexdigest() != expected:
            local.unlink(missing_ok=True)
            raise Error("virtual_screenshot_hash_mismatch")
        index = len(self.evidence) + 1
        observation_file = self.root / ('observation-%04d.json' % index)
        observation_raw = json.dumps(observation, ensure_ascii=False).encode('utf-8')
        observation_file.write_bytes(observation_raw)
        self.evidence.append({'observationId': observation['observationId'], 'observation': observation_file.name,
                              'observationSha256': hashlib.sha256(observation_raw).hexdigest(),
                              'screenshot': local.name, 'sha256': expected,
                              'ocrSkipped': observation.get('ocrSkipped') is True,
                              'hostPullAndValidateMs': round((time.monotonic() - pull_started) * 1000),
                              'deviceTiming': {key: value for key, value in (observation.get('deviceTiming') or {}).items()
                                               if key in ('screenCreateMs', 'launchSubmitMs', 'observeFrameMs', 'pngWriteMs',
                                                          'ocrAndRevalidationMs', 'captureTotalMs')
                                               and (value is None or type(value) is int and value >= 0)}
                              if isinstance(observation.get('deviceTiming'), dict) else {}})
        targets, nodes = {}, []
        page_nodes = list(solopi_ai.verification_nodes(observation))
        def semantic_key(node):
            text, description, role = (node.get('text'), node.get('description'), node.get('className'))
            if not all(isinstance(value, str) for value in (text, description, role)): return None
            text, description = (' '.join(value.split()).casefold() for value in (text, description))
            return (text, description, role) if text or description else None
        # Code security: visually identical labels without exposed context cannot authorize a guessed click.
        labels = Counter(semantic_key(node) for node in page_nodes
                         if node.get('packageName') == self.config['appId']
                         and node.get('isVisibleToUser') is True and node.get('isPassword') is not True
                         and node.get('isClickable') is True and semantic_key(node) is not None)
        for node in page_nodes:
            node_id = node.get("nodeId")
            if (node.get("packageName") != self.config["appId"] or not isinstance(node_id, str)
                    or node.get("isPassword") is True or node.get("isVisibleToUser") is not True
                    or node.get("isEnabled") is not True):
                continue
            actions = [name for name, flag in (("click", "isClickable"), ("scroll", "isScrollable")) if node.get(flag) is True]
            label = semantic_key(node)
            ambiguous = 'click' in actions and label is not None and labels[label] > 1
            if ambiguous: actions.remove('click')
            if not actions and not ambiguous:
                continue
            if actions: targets[node_id] = frozenset(actions)
            nodes.append({"id": node_id, "text": node.get("text", ""), "description": node.get("description", ""),
                          "resourceId": node.get("resourceId", ""), "role": node.get("className", ""),
                          "bounds": node.get("nodeBound"), "actions": actions,
                          **({'blockedReason': 'ambiguous_label'} if ambiguous else {})})
        # Code security: expose non-actionable text only if it belongs to the current visible window;
        # it must not become an actionable target merely because it can be read.
        readable = []
        for node in page_nodes:
            node_id = node.get('nodeId')
            if (not isinstance(node_id, str) or node_id in targets
                    or _visible_node_reason(node, observation, self.config['appId']) is not None):
                continue
            content = {key: node.get(key) if isinstance(node.get(key), str) else ''
                       for key in ('text', 'description')}
            if not (content['text'].strip() or content['description'].strip()): continue
            readable.append({'id': node_id, **content, 'role': node.get('className', ''),
                             'bounds': node.get('nodeBound'), 'enabled': node.get('isEnabled') is True})
        ocr = observation.get("ocr") if isinstance(observation.get("ocr"), dict) else {}
        windows = observation.get('windows') if isinstance(observation.get('windows'), list) else []
        owned_windows = [window for window in windows if isinstance(window, dict) and window.get('id') == observation.get('windowId')]
        owned_window = owned_windows[0] if len(owned_windows) == 1 else {}
        lines = []
        ocr_lines = ocr.get('lines') if isinstance(ocr.get('lines'), list) else []
        def ocr_label(line):
            value = line.get('text') if isinstance(line, dict) else None
            return ' '.join(value.split()).casefold() if isinstance(value, str) else ''
        # The phone refuses duplicate text; do not advertise it as an actionable candidate.
        ocr_labels = Counter(ocr_label(line) for line in ocr_lines if ocr_label(line))
        for line in ocr_lines:
            if (not isinstance(line, dict) or not re.fullmatch(r"ocr-[1-9][0-9]*", str(line.get("lineId", "")))
                    or line.get("protected") is True or not isinstance(line.get("text"), str)):
                continue
            line_id = line["lineId"]
            bounds = line.get("bounds")
            # OCR is a screenshot-derived reading, so it must obey the same window
            # visibility constraints as accessibility text before reaching the Agent.
            if _visible_node_reason({'packageName': self.config['appId'], 'isVisibleToUser': True,
                                     'isPassword': False, 'nodeBound': bounds}, observation,
                                    self.config['appId']) is not None:
                continue
            def overlaps(a, b):
                if not isinstance(a, dict) or not isinstance(b, dict): return True
                try:
                    return a['left'] < b['right'] and a['right'] > b['left'] and a['top'] < b['bottom'] and a['bottom'] > b['top']
                except (KeyError, TypeError): return True
            def contained(a, b):
                if not isinstance(a, dict) or not isinstance(b, dict): return False
                try:
                    return (b['left'] <= a['left'] < a['right'] <= b['right']
                            and b['top'] <= a['top'] < a['bottom'] <= b['bottom'])
                except (KeyError, TypeError): return False
            blocked = any(node.get('isVisibleToUser') is True and
                          (node.get('isEnabled') is False or node.get('isClickable') is True or node.get('isPassword') is True)
                          and overlaps(bounds, node.get('nodeBound')) for node in page_nodes)
            # Code security: background text outside the owned window cannot become an OCR action.
            inside_window = contained(bounds, owned_window.get('bounds'))
            ambiguous = bool(ocr_label(line)) and ocr_labels[ocr_label(line)] > 1
            if line.get("pixelsMatch") is True and line["text"].strip() and inside_window and not blocked and not ambiguous:
                targets[line_id] = frozenset({"click"})
            lines.append({"id": line_id, "text": line["text"], "pixelsMatch": line.get("pixelsMatch") is True,
                          "bounds": line.get("bounds"), "actionCandidate": line_id in targets,
                          **({'blockedReason': 'ambiguous_label'} if ambiguous else {})})
        # Code security: the phone derives and verifies the viewport; no model coordinates are accepted.
        root = page_nodes[0] if len(page_nodes) == 1 else {}
        viewport = (len(page_nodes) == 1 and not root.get("isClickable") and not root.get("isScrollable")
                    and not root.get("isPassword") and not root.get("text") and not root.get("description")
                    and any(line["actionCandidate"] for line in lines))
        if viewport:
            targets["viewport-1"] = frozenset({"scroll"})
        if self.action_outcome_unknown:
            # A fresh observation cannot prove whether an earlier physical action ran.
            targets = {}
            for node in nodes: node['actions'] = []
            for line in lines: line['actionCandidate'] = False
            viewport = False
        self.current, self.targets = observation, targets
        return {"observationId": observation["observationId"], "screenMode": "virtual",
                "displayId": observation["displayId"], "nodes": nodes, "readableNodes": readable, "ocr": lines,
                "viewport": {"id": "viewport-1", "actions": ["scroll"], "directions": ["up", "down"]} if viewport else None,
                "ocrFreshness": ocr.get("freshness"), "ocrError": observation.get("ocrError"),
                "actionBlockedReason": "virtual_action_outcome_unconfirmed" if self.action_outcome_unknown else None,
                "actionEffect": observation.get("actionEffect"),
                "screenshotDataUrl": "data:image/png;base64," + base64.b64encode(raw).decode("ascii")}

    def observe(self, skip_ocr=False):
        self.current, self.targets = None, {}
        command = ["agent-observe", *self._identity()]
        if skip_ocr: command.append("--skip-virtual-ocr")
        result, code = solopi_ai.command_agent_observe(self._args(command), self.adb)
        if code or result.get("success") is not True:
            raise Error(result.get("errorCode") or "virtual_observe_failed")
        return self._frame(result["observation"])

    def preview(self):
        if self.current is None: raise Error("virtual_preview_unavailable")
        with solopi_ai.session_from_args(self._args(["agent-status", *self._identity()]), self.adb,
                                         preserve_foreground=True) as session:
            result = session.agent("virtual-preview", {"sessionId": self.session_id, "ownerToken": self.owner_token}, timeout=2)
        if (result.get("success") is not True or result.get("displayId") != self.current.get("displayId")
                or not isinstance(result.get("image"), str)):
            raise Error(result.get("errorCode") or "virtual_preview_unavailable")
        try: raw = base64.b64decode(result["image"], validate=True)
        except ValueError as exc: raise Error("virtual_preview_invalid") from exc
        validate_png(raw)
        return {"displayId": result["displayId"], "frameUptimeMs": result.get("frameUptimeMs"),
                "screenshotDataUrl": "data:image/png;base64," + base64.b64encode(raw).decode("ascii")}

    def act(self, value):
        action_started = time.monotonic()
        if self.action_outcome_unknown:
            raise Error('virtual_action_outcome_unconfirmed')
        if not isinstance(value, dict) or set(value) - {"observationId", "targetId", "action", "direction"}:
            raise Error("invalid_virtual_action")
        if self.current is None or value.get("observationId") != self.current.get("observationId"):
            raise Error("stale_observation")
        target_id, action = value.get("targetId"), value.get("action")
        if not isinstance(target_id, str) or not isinstance(action, str) or action not in self.targets.get(target_id, ()):
            raise Error("unknown_virtual_target")
        if action == "scroll" and value.get("direction") not in {"up", "down", "left", "right"}:
            raise Error("invalid_scroll_direction")
        if target_id == "viewport-1" and value.get("direction") not in {"up", "down"}:
            raise Error("invalid_scroll_direction")
        if action != "scroll" and "direction" in value:
            raise Error("invalid_virtual_action")
        command = ["agent-act", *self._identity(), "--step-id", "desktop-" + uuid.uuid4().hex,
                   "--observation-id", self.current["observationId"], "--action", action,
                   "--node-id", target_id, "--action-timeout", "60"]
        if action == "scroll": command += ["--direction", value["direction"]]
        event = {'type': 'action', 'stepId': command[command.index('--step-id') + 1],
                 'observationId': self.current['observationId'], 'targetId': target_id,
                 'action': action, 'state': 'submitted', 'timestamp': int(time.time() * 1000)}
        self.events.append(event)
        self._write_report('pending')
        self.current, self.targets = None, {}
        # Code security: after dispatch starts, no fresh observation can authorize another action
        # until a successful receipt and its bound settled observation are both verified.
        self.action_outcome_unknown = True
        result, code = solopi_ai.command_agent_act(self._args(command), self.adb)
        receipt = result.get("receipt") if isinstance(result.get("receipt"), dict) else {}
        if receipt:
            receipt_file = self.root / ('receipt-%04d.json' % len(self.events))
            receipt_raw = json.dumps(receipt, ensure_ascii=False).encode('utf-8')
            receipt_file.write_bytes(receipt_raw)
            event['receipt'] = receipt_file.name
            event['receiptSha256'] = hashlib.sha256(receipt_raw).hexdigest()
        if code or receipt.get("status") != "succeeded" or not isinstance(receipt.get("settledObservation"), dict):
            event['state'] = 'unconfirmed'
            event['durationMs'] = round((time.monotonic() - action_started) * 1000)
            self._write_report('pending')
            # Code security: map only fixed device errors; never return page data or arbitrary exception text.
            if receipt.get('error') == 'Virtual action was submitted; protected or blank frame prevents confirmation':
                raise Error('virtual_protected_or_blank_after_dispatch')
            if receipt.get('error') == 'Virtual action: target_protected_or_blank':
                raise Error('virtual_protected_or_blank_target')
            if receipt.get('error') == 'Virtual action was submitted; target is active on main display; outcome may be unknown':
                raise Error('virtual_target_on_main')
            if isinstance(receipt.get('error'), str) and re.fullmatch(
                    r'Virtual action was submitted; settle timed out \(reason=(?:no_stable_pair|page_changed|virtual_window_unavailable|virtual_observation_unstable|virtual_frame_unavailable|stale_observation|unknown)\); outcome may be unknown',
                    receipt['error']):
                raise Error('virtual_settle_unconfirmed')
            raise Error(receipt.get("errorCode") or "virtual_action_outcome_unconfirmed")
        event['state'] = 'succeeded'
        self.action_outcome_unknown = False
        try:
            frame = self._frame(receipt["settledObservation"])
        except BaseException:
            self.action_outcome_unknown = True
            event['state'] = 'unconfirmed'
            self.current, self.targets = None, {}
            raise
        event['durationMs'] = round((time.monotonic() - action_started) * 1000)
        return {"receipt": {"status": "succeeded", "stepId": receipt.get("stepId")}, **frame}

    def _judge(self, completed):
        if self.judgement is not None: return
        self.judgement = []
        if not completed:
            self.judgement = [{'oracle': c, 'status': 'not_tested', 'reason': 'task_not_completed'} for c in self.checks]
            return
        if not self.checks: return
        started = time.monotonic()
        try:
            self.observe(skip_ocr=True)
            nodes = list(solopi_ai.verification_nodes(self.current))
            usable = len(nodes) > 1 or bool(nodes and (nodes[0].get('text') or nodes[0].get('description')))
            for oracle in self.checks:
                if not usable:
                    status, reason, actual = 'not_tested', 'accessibility_tree_unavailable', None
                else:
                    status, reason, actual = _visible_oracle_result(oracle, self.current, self.config['appId'])
                self.judgement.append({'oracle': oracle, 'status': status, 'reason': reason, 'actual': actual,
                                       'observationId': self.current['observationId']})
        except Exception:
            self.judgement = [{'oracle': c, 'status': 'not_tested', 'reason': 'observation_unavailable'} for c in self.checks]
        finally:
            self.judge_duration_ms = round((time.monotonic() - started) * 1000)

    def _write_report(self, cleanup):
        checks = [dict(check) for check in self.judgement] if self.judgement is not None else [
            {'oracle': c, 'status': 'not_tested', 'reason': 'task_in_progress'} for c in self.checks]
        if self.judgement is not None and (not self._evidence_intact()
                or any(check.get('status') != 'not_tested' and
                       check.get('observationId') != self.evidence[-1]['observationId'] for check in checks)):
            checks = [{**check, 'status': 'not_tested', 'reason': 'evidence_unavailable', 'actual': None}
                      if check['status'] != 'not_tested' else check for check in checks]
        statuses = [c['status'] for c in checks]
        status = ('failed' if 'failed' in statuses else
                  'not_tested' if cleanup != 'confirmed' or not statuses or 'not_tested' in statuses else 'passed')
        report = {'schema': 'solopi.virtual-agent-report.v1', 'sessionId': self.session_id,
                  'platform': 'android', 'appId': self.config['appId'], 'status': status,
                  'cleanup': cleanup, 'checkpoints': checks, 'events': self.events, 'evidence': self.evidence,
                  'timing': {'elapsedMs': round((time.monotonic() - self.started_at) * 1000),
                             'startHostMs': self.start_duration_ms, 'cleanupHostMs': self.cleanup_duration_ms,
                             'finalObservationAndJudgeMs': self.judge_duration_ms}}
        # Code security: fixed names inside the private per-run root; never use caller-controlled paths.
        self._write_atomic('report.json', json.dumps(report, ensure_ascii=False, indent=2))
        rows = ''.join('<li>定位 %s；预期 %s；实际 %s；结果 %s (%s)</li>' % (
                       html.escape(str(c['oracle']['selector'])), html.escape(c['oracle']['expected']),
                       html.escape(str(c.get('actual', '未采集'))), html.escape(c['status']),
                       html.escape(c['reason'])) for c in checks)
        steps = ''.join('<li>%s · %s · %s · %s ms%s</li>' % (html.escape(e['action']), html.escape(e['targetId']),
                        html.escape(e['state']), html.escape(str(e.get('durationMs', '未确认'))), (' · <a href="%s">查看回执</a>' % html.escape(e['receipt'], quote=True))
                        if e.get('receipt') else '') for e in self.events)
        pictures = ''.join('<figure><figcaption><a href="%s">观察 %d</a></figcaption><img src="%s" style="max-width:300px;height:auto"></figure>'
                           % (html.escape(item['observation'], quote=True), i, html.escape(item['screenshot'], quote=True))
                           for i, item in enumerate(self.evidence, 1))
        phase_labels = [('screenCreateMs', '副屏创建'), ('launchSubmitMs', '应用启动提交'),
                        ('observeFrameMs', '页面树与画面绑定'), ('pngWriteMs', '截图编码与写入'),
                        ('ocrAndRevalidationMs', 'OCR 与画面复核'), ('captureTotalMs', '手机端观察总计')]
        def duration(value): return str(value) if type(value) is int and value >= 0 else '未采集'
        phases = ''.join('<li>观察 %d：%s；电脑拉取和校验 %s ms</li>' % (
            index, '；'.join('%s %s' % (label, '验收阶段跳过' if key == 'ocrAndRevalidationMs' and item.get('ocrSkipped')
                                      else duration(item.get('deviceTiming', {}).get(key)) + ' ms')
                             for key, label in phase_labels), duration(item.get('hostPullAndValidateMs')))
            for index, item in enumerate(self.evidence, 1))
        body = '<!doctype html><meta charset="utf-8"><title>SoloPi 副屏任务报告</title><h1>副屏任务报告</h1>'
        body += '<p>结果：%s；清理：%s；会话耗时：%s ms</p><h2>固定验收</h2><ul>%s</ul><h2>动作回执</h2><ul>%s</ul><h2>阶段耗时</h2><p>电脑启动 %s ms；结束验收 %s ms；清理 %s ms。手机端观察总计包含采集、截图和 OCR 等阶段；启动和动作也包含观察，重叠时间不能相加。启动提交不代表页面已就绪。</p><ul>%s</ul><h2>页面截图</h2>%s' % (html.escape(status), html.escape(cleanup), report['timing']['elapsedMs'], rows, steps,
            duration(self.start_duration_ms), duration(self.judge_duration_ms), duration(self.cleanup_duration_ms), phases, pictures)
        self._write_atomic('report.html', body)
        return {'status': status, 'checkpoints': checks, 'cleanup': cleanup,
                'reportPath': str(self.root / 'report.html')}

    def _evidence_intact(self):
        if not self.evidence: return False
        try:
            for index, item in enumerate(self.evidence):
                image = (self.root / item['screenshot']).read_bytes()
                dimensions = validate_png(image)
                observation_raw = (self.root / item['observation']).read_bytes()
                snapshot = json.loads(observation_raw)
                if not isinstance(snapshot, dict): return False
                if (hashlib.sha256(image).hexdigest() != item['sha256']
                        or hashlib.sha256(observation_raw).hexdigest() != item['observationSha256']
                        or snapshot.get('observationId') != item['observationId']
                        or snapshot.get('displayId') != self.display_id
                        or snapshot.get('screenMode') != 'virtual'
                        or dimensions != (snapshot.get('screenWidth'), snapshot.get('screenHeight'))
                        or (index == len(self.evidence) - 1 and snapshot != self.current)):
                    return False
            for event in self.events:
                if event.get('state') != 'succeeded': return False
                receipt_raw = (self.root / event['receipt']).read_bytes()
                if hashlib.sha256(receipt_raw).hexdigest() != event['receiptSha256']: return False
                receipt = json.loads(receipt_raw)
                if not isinstance(receipt, dict): return False
                if (receipt.get('status') != 'succeeded' or receipt.get('stepId') != event['stepId']
                        or receipt.get('observationId') != event['observationId']): return False
            return True
        except (KeyError, OSError, TypeError, ValueError):
            return False

    def _write_atomic(self, name, content):
        temporary = self.root / ('.' + uuid.uuid4().hex + '.tmp')
        try:
            with temporary.open('x', encoding='utf-8') as stream:
                stream.write(content)
                stream.flush()
            os.replace(temporary, self.root / name)
        finally:
            temporary.unlink(missing_ok=True)

    def close(self, completed=False):
        if not self.owner_token: return {"state": "closed", "cleanupConfirmed": True}
        if not self.adb.start_dispatched and not self.session_id:
            self.owner_token = None
            return {"state": "closed", "cleanupConfirmed": True}
        if not self.session_id:
            # The start may have reached the device before a transport failure.
            with solopi_ai.session_from_args(self._args(["agent-session-start"]), self.adb,
                                             preserve_foreground=True) as session:
                lookup = session.agent("start-status", {"ownerToken": self.owner_token})
            value = lookup.get("session") if lookup.get("success") is True else None
            if not isinstance(value, dict) or not isinstance(value.get("sessionId"), str):
                raise Error("virtual_cleanup_unconfirmed")
            self.session_id = value["sessionId"]
        identity = self._identity()
        self._judge(completed)
        try:
            self._write_report('pending')
        except OSError:
            # Cleanup must still run even if the evidence filesystem is unavailable.
            pass
        cleanup_started = time.monotonic()
        status, code = solopi_ai.command_agent_query(self._args(["agent-status", *identity]), self.adb, "status")
        if code or status.get("success") is not True:
            raise Error("virtual_cleanup_unconfirmed")
        state = status.get("session") or {}
        if state.get("state") not in solopi_ai.AGENT_TERMINAL_STATES:
            status, code = solopi_ai.command_agent_mutation(self._args(["agent-cancel", *identity]), self.adb, "cancel")
            state = status.get("session") or {}
        elif state.get("cleanupPending") is True:
            status, code = solopi_ai.command_agent_mutation(self._args(["agent-cleanup", *identity]), self.adb, "cleanup")
            state = status.get("session") or {}
        if code or state.get("leaseHeld") is not False or state.get("cleanupPending") is not False:
            raise Error("virtual_cleanup_unconfirmed")
        self.cleanup_duration_ms = round((time.monotonic() - cleanup_started) * 1000)
        try:
            report = self._write_report('confirmed')
        except OSError:
            report = {'status': 'not_tested', 'checkpoints': self.judgement or [],
                      'cleanup': 'confirmed', 'reportPath': None, 'error': 'report_export_failed'}
        self.session_id = self.owner_token = self.current = None
        self.targets = {}
        return {"state": "closed", "cleanupConfirmed": True, "report": report,
                **({'artifacts': str(self.root)} if report.get('reportPath') else {})}
