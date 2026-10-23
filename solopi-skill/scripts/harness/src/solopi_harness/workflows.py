"""Packaged workflows: one entry to existing verification, optional local models.

The APK remains the executor. This module never sends raw device commands,
changes an oracle, downloads a model, or substitutes its own business verdict.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
import hashlib
import html
import importlib.util
from pathlib import Path
import re
import time
import uuid


SCHEMA = "solopi.workflow-run/v1"
RESOURCE_ROOT = Path(__file__).resolve().parent / "resources" / "workflows"
TEMPLATES = {
    "alipay-more-services": {
        "title": "支付宝更多服务往返", "provider": "fastpath",
        "description": "打开更多服务，核对标题与返回入口，再返回首页。",
    },
    "alipay-education": {
        "title": "支付宝教育公益分类浏览", "provider": "goalpath",
        "description": "打开更多服务，浏览教育公益分类，核对公益入口后返回首页。",
    },
    "alipay-settings": {
        "title": "支付宝设置页面查看", "provider": "fastpath",
        "description": "从我的页面打开设置，核对标题与返回入口，恢复首页。",
    },
}


def catalog():
    return {"success": True, "defaultMode": "rules", "modelDeployment": "host-local",
            "templates": [{"id": key, **value, "targetPackage": "com.eg.android.AlipayGphone",
                "initialPage": "已登录的支付宝首页，无键盘和弹窗",
                "modes": ["rules", "laya"], "experimentalModes": ["laya"],
                "mutations": "只浏览并返回，不支付、不修改设置"}
                for key, value in TEMPLATES.items()]}


def digest(path):
    with path.open("rb") as stream:
        checksum = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def is_png(path):
    with path.open("rb") as stream:
        header = stream.read(24)
    return (len(header) == 24 and header[:8] == b"\x89PNG\r\n\x1a\n"
            and header[12:16] == b"IHDR" and int.from_bytes(header[16:20], "big") > 0
            and int.from_bytes(header[20:24], "big") > 0)


def _within(root, relative, api):
    # Code security: all report references stay inside the selected run, even
    # after symlink resolution. Template IDs are allowlisted before path use.
    raw = Path(relative)
    if raw.is_absolute() or ".." in raw.parts:
        raise api.CliError("运行证据路径越界", 3, errorCode="workflow_path_escape")
    candidate = (root / raw).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise api.CliError("运行证据路径越界", 3, errorCode="workflow_path_escape") from exc
    return candidate


def _write(root, relative, value, api):
    target = _within(root, relative, api)
    api._write_timing_json_atomic(target, value)


def _text(value):
    # Code security: page/error text is never copied into the public summary;
    # even local identifiers are escaped for both HTML and Markdown contexts.
    text = html.escape(str(value).replace("\r", " ").replace("\n", " "), quote=True)
    return re.sub(r"([\\`*_{\[\]}()|!#])", r"\\\1", text)[:500]


def _summary(report):
    return [{"id": s["scenarioId"], "status": s["status"],
             "cleanup": s["cleanup"]["status"],
             "failureCategory": (s.get("failure") or {}).get("category"),
             "checkpoints": [{"id": c["checkpointId"], "status": c["status"]}
                             for c in s["checkpoints"]]}
            for s in report["scenarios"]]


def _markdown(state):
    lines = ["# " + _text(state["title"]), "",
             "- 验收结果：**" + _text(state["status"]) + "**",
             "- 工作流状态：" + _text(state["state"]),
             "- 决策模式：" + _text(state["mode"]) + ("（本地实验模式）" if state["mode"] == "laya" else "（不加载模型）"),
             "- 执行配置：" + _text(state["profile"]),
             "- 工作流耗时：%.3f 秒（含预检、执行及截图；不含最后的报告写入）" % (state["elapsedMs"] / 1000), ""]
    if state.get("errorCode"):
        lines += ["运行提示：" + _text(state["errorCode"]), ""]
    if state.get("nextAction"):
        lines += [_text(state["nextAction"]), ""]
    if state.get("missingPermissions"):
        lines += ["缺少设备条件：" + ", ".join(_text(x) for x in state["missingPermissions"]), ""]
    if state.get("scenarios"):
        lines += ["## 验收与清理", "", "| 检查点 | 结果 |", "|---|---|"]
        for scenario in state["scenarios"]:
            lines += ["| " + _text(scenario["id"] + "/" + item["id"]) + " | " + _text(item["status"]) + " |"
                      for item in scenario["checkpoints"]]
            lines += ["| " + _text(scenario["id"] + "/清理") + " | " + _text(scenario["cleanup"]) + " |"]
            if scenario["failureCategory"]:
                lines += ["| 失败类别 | " + _text(scenario["failureCategory"]) + " |"]
        lines += ["", "[Harness 原始报告](run/report.json) · [冻结计划](plan.json)", ""]
    lines += ["## 完整截图", "", "截图保留原始屏幕，不裁剪；可能含个人信息，目录默认仅本机用户可访问。", ""]
    for item in state["screenshots"]:
        lines += ["### " + _text(item["label"]), "", "![整屏截图](" + item["path"] + ")", ""]
    if not state["screenshots"]:
        lines += ["本次没有可用截图。", ""]
    lines += ["业务结论来自本次 Harness 固定验收与所需清理。模型选择或动作回执本身不代表测试通过。", ""]
    return "\n".join(lines)


def _capture(root, filename, label, args, adb, api, state):
    target = _within(root, filename, api)
    shot_args = copy.copy(args)
    shot_args.output = str(target)
    _, code = api.command_screenshot(shot_args, adb)
    if code or not target.is_file() or not is_png(target):
        raise api.CliError("整屏截图导出失败", 4, errorCode="workflow_screenshot_failed")
    target.chmod(0o600)
    state["screenshots"].append({"path": filename, "label": label})


def _verify_args(args, template, root, api):
    run = api.build_parser().parse_args(["verify-run", "--plan", str(root / "plan.json"),
        "--artifacts", str(root / "run"), "--decision-provider", template["provider"],
        "--no-restart-app", "--segment-screenshots"])
    for field in ("adb", "serial", "package", "device_port", "local_port", "request_timeout", "startup_timeout"):
        setattr(run, field, getattr(args, field))
    run.transport_mode = "shared"
    run.settle_strategy = "event-stable-v1" if args.profile == "optimized" else "legacy"
    run.action_validation_strategy = "target-context-v1" if args.profile == "optimized" else "full-page"
    if template["provider"] == "fastpath":
        run.fastpath_policy = str(root / "policy.json")
        run.fastpath_backend = "rules" if args.mode == "rules" else "mlx"
    else:
        run.goalpath_policy = str(root / "policy.json")
        run.goalpath_mode = args.mode
        run.fastpath_backend = "mlx"
    if args.model:
        run.fastpath_model = str(Path(args.model).expanduser().resolve())
    return run


def _finish(root, state, started, api):
    state["elapsedMs"] = round((time.perf_counter() - started) * 1000, 3)
    state["finishedAt"] = datetime.now(timezone.utc).isoformat()
    # Report links are from fixed filenames or checked same-run evidence only.
    markdown = _within(root, "REPORT.md", api)
    markdown.write_text(_markdown(state), encoding="utf-8")
    markdown.chmod(0o600)
    names = ["requirement.json", "policy.json", "plan.json", "REPORT.md"]
    names += [s["path"] for s in state["screenshots"]]
    if (root / "run/report.json").is_file():
        names += ["run/report.json"]
    state["filesSha256"] = {name: digest(_within(root, name, api)) for name in sorted(set(names))}
    _write(root, "workflow.json", state, api)
    return _payload(root, state)


def _payload(root, state):
    return {"success": state["state"] == "completed" and state["status"] == "passed",
            "status": state["status"], "state": state["state"], "template": state["template"],
            "mode": state["mode"], "profile": state["profile"], "elapsedMs": state["elapsedMs"],
            "errorCode": state.get("errorCode"), "nextAction": state.get("nextAction"),
            "missingPermissions": state.get("missingPermissions", []), "artifacts": str(root),
            "report": str(root / "REPORT.md"), "manifest": str(root / "workflow.json"),
            "verificationReport": str(root / "run/report.json") if state.get("reportId") else None,
            "screenshots": [str(root / item["path"]) for item in state["screenshots"]],
            "scenarios": state.get("scenarios", [])}


def run_workflow(args, adb, api):
    try:
        return _run_workflow(args, adb, api)
    except OSError as exc:
        raise api.CliError("无法读写本地工作流证据", 4, errorCode="workflow_storage_failed") from exc


def _run_workflow(args, adb, api):
    template = TEMPLATES.get(args.template)
    if template is None:
        raise api.CliError("未知工作流模板；先运行 workflow-list", 3)
    if args.mode == "rules" and args.model:
        raise api.CliError("规则模式不接受模型参数", 3)
    if args.mode == "laya":
        if not args.model or not (Path(args.model).expanduser() / "model.safetensors").is_file():
            raise api.CliError("Laya 实验模式需要 --model 指定本地 MLX 权重目录", 3)
        if importlib.util.find_spec("laya_mlx") is None:
            raise api.CliError("当前 Python 环境未安装 laya-mlx；请激活本地模型环境", 3)
    # Compile and validate bundled contracts before any device operation.
    source = RESOURCE_ROOT / args.template
    requirement = api.load_json_file(source / "requirement.json")
    policy = api.load_json_file(source / "policy.json")
    api.model_call(lambda: (api.fastpath if template["provider"] == "fastpath" else api.goalpath).validate_policy(policy))
    plan = api.verification_call(lambda: api.verification_engine.compile_verification_plan(requirement))
    api.verification_call(lambda: api.verification_engine.validate_verification_plan(plan))
    name = args.template + "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    root = Path(args.artifacts).expanduser() if args.artifacts else Path.home() / ".solopi-ai/runs" / name
    # Code security: private, fresh directory; never merge with an old run or
    # write through a caller-supplied existing directory/symlink.
    if root.exists() or root.is_symlink():
        raise api.CliError("工作流证据目录必须是新目录", 3)
    root = root.resolve()
    try:
        root.mkdir(parents=True, mode=0o700, exist_ok=False)
    except OSError as exc:
        raise api.CliError("无法创建工作流证据目录", 3) from exc
    started = time.perf_counter()
    state = {"schemaVersion": SCHEMA, "template": args.template, "title": template["title"],
             "mode": args.mode, "profile": args.profile, "status": "not_tested", "state": "running",
             "planFingerprint": plan["planFingerprint"], "screenshots": [], "scenarios": [],
             "startedAt": datetime.now(timezone.utc).isoformat(), "elapsedMs": 0}
    for filename, data in (("requirement.json", requirement), ("policy.json", policy), ("plan.json", plan)):
        _write(root, filename, data, api)
    _write(root, "workflow.json", state, api)
    code = 2
    stage = "preflight"
    try:
        doctor, doctor_code = api.command_doctor(args, adb)
        if doctor_code or doctor.get("success") is not True:
            state["missingPermissions"] = doctor.get("missingPermissions", [])
            raise api.CliError("设备未就绪", 2, errorCode="device_not_ready")
        capabilities, cap_code = api.command_query(args, adb, "capabilities")
        run_args = _verify_args(args, template, root, api)
        if cap_code or run_args.settle_strategy not in capabilities.get("settleStrategies", []) or run_args.action_validation_strategy not in capabilities.get("actionValidationStrategies", []):
            raise api.CliError("设备不支持所选执行配置", 2, errorCode="workflow_profile_unsupported")
        stage = "execution"
        _capture(root, "initial.png", "执行前", args, adb, api, state)
        result, code = api.command_verify_run(run_args, adb)
        report = api.load_json_file(root / "run/report.json")
        if report.get("planFingerprint") != state["planFingerprint"] or report.get("reportId") != result.get("reportId"):
            raise api.CliError("验证报告不属于本次计划或运行", 4, errorCode="workflow_report_mismatch")
        state.update(status=report["status"], reportId=report["reportId"], scenarios=_summary(report))
        if code != (0 if report["status"] == "passed" else 2) or result.get("status") != report["status"]:
            raise api.CliError("运行回执与验收报告不一致", 4, errorCode="workflow_report_mismatch")
        expected_shots = {(s["phase"], s["segmentId"]) for scenario in report["scenarios"] for s in scenario["segments"]}
        indexed_shots = {(s["phase"], s["segmentId"]) for s in report.get("screenshots", [])}
        screenshot_failed = "screenshots" not in report or expected_shots != indexed_shots
        for shot in report.get("screenshots", []):
            if shot["status"] != "captured":
                screenshot_failed = True
                continue
            path = Path(shot["path"]).resolve()
            try:
                relative = path.relative_to(root).as_posix()
            except ValueError as exc:
                raise api.CliError("截图不属于本次运行", 4, errorCode="workflow_path_escape") from exc
            _within(root, relative, api)
            state["screenshots"].append({"path": relative, "label": shot["phase"] + " / " + shot["segmentId"]})
        _capture(root, "final.png", "执行与清理后的当前页面", args, adb, api, state)
        if screenshot_failed:
            raise api.CliError("部分执行段缺少截图", 4, errorCode="workflow_screenshot_failed")
        state["state"] = "completed"
    except KeyboardInterrupt:
        state.update(state="interrupted", errorCode="workflow_interrupted")
        code = 130
    except (api.CliError, OSError) as exc:
        # Code security: retain only typed error codes; never echo exception
        # payloads, UI text, raw model output or credentials in this summary.
        details = getattr(exc, "details", {})
        state.update(state="stopped", errorCode=details.get("errorCode", "workflow_" + stage + "_error"))
        if stage == "preflight":
            state["nextAction"] = "运行 doctor 查看设备与权限状态；USB 未授权时需在手机确认允许调试。"
        code = getattr(exc, "exit_code", 4)
    return _finish(root, state, started, api), code


def read_report(args, api):
    try:
        return _read_report(args, api)
    except (KeyError, TypeError, ValueError) as exc:
        raise api.CliError("工作流证据清单格式无效", 3, errorCode="workflow_manifest_invalid") from exc
    except OSError as exc:
        raise api.CliError("无法读取本地工作流证据", 3, errorCode="workflow_storage_failed") from exc


def _read_report(args, api):
    root = Path(args.artifacts).expanduser().resolve()
    state = api.load_json_file(_within(root, "workflow.json", api))
    if not isinstance(state, dict) or state.get("schemaVersion") != SCHEMA or state.get("template") not in TEMPLATES:
        raise api.CliError("不是可识别的工作流报告", 3)
    if state.get("state") == "running":
        return {"success": False, "status": "not_tested", "state": "running",
                "artifacts": str(root), "hint": "运行尚未导出终态；不要重发动作或将其视为通过"}, 2
    if (state.get("state") not in {"completed", "stopped", "interrupted"}
            or state.get("status") not in {"passed", "failed", "not_tested"}
            or state.get("mode") not in {"rules", "laya"}
            or state.get("profile") not in {"optimized", "baseline"}
            or (state.get("status") == "passed" and not state.get("reportId"))):
        raise api.CliError("工作流终态无效", 3, errorCode="workflow_manifest_invalid")
    hashes = state.get("filesSha256", {})
    if not isinstance(hashes, dict):
        raise api.CliError("工作流证据清单格式无效", 3, errorCode="workflow_manifest_invalid")
    required = {"requirement.json", "policy.json", "plan.json", "REPORT.md"}
    required.update(item["path"] for item in state.get("screenshots", []))
    if state.get("reportId"):
        required.add("run/report.json")
    if not required.issubset(hashes):
        raise api.CliError("工作流证据清单不完整", 3)
    for relative, expected in hashes.items():
        path = _within(root, relative, api)
        if not path.is_file() or digest(path) != expected:
            raise api.CliError("工作流证据缺失或已改变", 3, errorCode="workflow_evidence_changed")
    if state.get("reportId"):
        report = api.load_json_file(_within(root, "run/report.json", api))
        if (not isinstance(report, dict) or report.get("reportId") != state["reportId"]
                or report.get("planFingerprint") != state["planFingerprint"] or report.get("status") != state["status"]
                or _summary(report) != state.get("scenarios")):
            raise api.CliError("工作流摘要与验收报告不一致", 3)
    payload = _payload(root, state)
    payload["evidenceIntegrity"] = "verified"
    return payload, 0 if payload["success"] else 2
