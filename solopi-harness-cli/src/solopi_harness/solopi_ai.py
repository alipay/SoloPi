#!/usr/bin/env python3
"""SoloPi AI Harness 的机器可读宿主机命令行。"""

from __future__ import annotations

import argparse
import codecs
import copy
import csv
import hashlib
import io
import json
import math
import os
import re
import shlex
import stat
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
if str(SCRIPT_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIRECTORY))
import verification_engine
import managed_execution
import model_deployment


DEFAULT_PACKAGE = "com.alipay.hulu"
MODEL_COMPANION_PACKAGE = "com.alipay.hulu.agentmodel"
MODEL_CONTROL_URI = "content://com.alipay.hulu.agentmodel.control"
MODEL_STAGING_URI = MODEL_CONTROL_URI + "/staging"
DEFAULT_MODEL_PUBLIC_KEY = (
    SCRIPT_DIRECTORY / "resources" / "keys" / "solopi-poc-2026-public.pem"
)
ADB_SCHEME_ACTIVITY = "com.alipay.hulu.common.scheme.AdbSchemeActivity"
DEFAULT_DEVICE_PORT = 23342
ADB_CONNECT_STATES = {"connecting", "connected", "failed"}
ADB_CONNECT_TERMINAL_STATES = {"connected", "failed"}
ADB_CONNECT_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
ADB_CONNECT_REQUIRED_USER_ACTION = (
    "请确认 SoloPi 配置的内部 ADB 地址可连接，并在设备上确认 RSA 授权弹窗"
)
TERMINAL_STATES = {"passed", "failed", "cancelled"}
AGENT_TERMINAL_STATES = {"ended", "cancelled", "failed", "expired"}
AGENT_RECEIPT_TERMINAL_STATES = {"succeeded", "rejected", "failed"}
AGENT_ACTIONS = ("click", "longClick", "input", "back", "home", "scroll", "wait")
AGENT_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}")
AGENT_OWNER_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9._-]{16,160}")
PERFORMANCE_TERMINAL_STATES = {"stopped", "failed"}
PERFORMANCE_ACTIVE_STATES = {"starting", "recording", "stopping"}
PERFORMANCE_STATES = {"idle"} | PERFORMANCE_ACTIVE_STATES | PERFORMANCE_TERMINAL_STATES
PERFORMANCE_STOP_MAX_CLEANUP_RETRIES = 3
PERFORMANCE_DISPLAY_TERMINAL_STATES = {"stopped", "failed"}
PERFORMANCE_DISPLAY_ACTIVE_STATES = {"starting", "running", "stopping"}
PERFORMANCE_DISPLAY_STATES = (
    {"idle"} | PERFORMANCE_DISPLAY_ACTIVE_STATES | PERFORMANCE_DISPLAY_TERMINAL_STATES
)
PERFORMANCE_DISPLAY_STOP_MAX_CLEANUP_RETRIES = 3
PERFORMANCE_DISPLAY_SESSION_ID_PATTERN = re.compile(
    r"[A-Za-z0-9][A-Za-z0-9._-]{0,115}"
)
RECORD_TERMINAL_STATES = {"stopped", "failed"}
RECORD_ACTIVE_STATES = {"starting", "recording", "stopping"}
RECORD_STATES = {"idle"} | RECORD_ACTIVE_STATES | RECORD_TERMINAL_STATES
SCREEN_RECORD_TERMINAL_STATES = {"stopped", "failed"}
SCREEN_RECORD_ACTIVE_STATES = {
    "pending-user-confirmation",
    "starting",
    "recording",
    "stopping",
}
SCREEN_RECORD_STATES = {"idle"} | SCREEN_RECORD_ACTIVE_STATES | SCREEN_RECORD_TERMINAL_STATES
SCREEN_RECORD_SESSION_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,128}")
SCREEN_RECORD_RESOLUTION_PATTERN = re.compile(r"(\d{3,4})x(\d{3,4})")
SCREEN_RECORD_FILE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.mp4")
SCREEN_RECORD_REQUIRED_USER_ACTION = "Confirm the Android MediaProjection system dialog"
SCREEN_RECORD_CLEANUP_TIMEOUT = 15.0
SCAN_TERMINAL_STATES = {"completed", "cancelled", "failed"}
SCAN_ACTIVE_STATES = {"starting", "pending-camera-permission", "scanning"}
SCAN_STATES = {"idle"} | SCAN_ACTIVE_STATES | SCAN_TERMINAL_STATES
SCAN_SESSION_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
SCAN_REQUIRED_USER_ACTIONS = {
    "pending-camera-permission": "Grant camera permission on the device",
    "scanning": "Aim the camera at a supported code",
}
SCAN_FORMAT_CODE_TYPES = {
    "EAN_13": "EAN-13",
    "EAN_8": "EAN-8",
    "CODE_128": "CODE 128",
    "CODE_39": "CODE 39",
    "QR_CODE": "QR CODE",
    "PDF_417": "PDF 417",
    "DATA_MATRIX": "Datamatrix",
}
SCAN_CLEANUP_TIMEOUT = 10.0
VIDEO_ANALYSIS_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
VIDEO_ANALYSIS_STATES = {"analyzing", "completed", "failed"}
VIDEO_ANALYSIS_TERMINAL_STATES = {"completed", "failed"}
VIDEO_ANALYSIS_MAX_ACTION_OFFSET_MS = 60 * 60 * 1000
VIDEO_ANALYSIS_MEASUREMENT = "SoloPi screen-recording video difference"
VIDEO_ANALYSIS_ERROR_CODES = {
    "missing_action",
    "unsupported_action",
    "adb_required",
    "invalid_request_id",
    "invalid_parameter",
    "unsafe_video_path",
    "plugin_missing",
    "analysis_busy",
    "analysis_not_found",
    "analysis_failed",
}
STRESS_TERMINAL_STATES = {"stopped", "failed"}
STRESS_ACTIVE_STATES = {"starting", "running", "stopping"}
STRESS_STATES = {"idle"} | STRESS_ACTIVE_STATES | STRESS_TERMINAL_STATES
STRESS_MAX_CPU_PERCENT = 100
STRESS_MAX_MEMORY_MB = 2048
STRESS_MAX_DURATION_SECONDS = 3600
HISTORY_DEFAULT_LIMIT = 100
HISTORY_MAX_LIMIT = 500
HISTORY_ID_PATTERNS = {
    "replay": re.compile(r"replay-[0-9a-f]{64}"),
    "performance": re.compile(r"performance-[0-9a-f]{64}"),
}
PLUGIN_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
PLUGIN_ID_PATTERN = re.compile(r"plugin-[0-9a-f]{64}")
PLUGIN_IMPORT_ID_PATTERN = re.compile(r"plugin-import-[0-9a-f]{64}")
PLUGIN_IMPORT_FILE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.zip")
PLUGIN_GENERATED_FILE_PATTERN = re.compile(r"solopi-plugin-[0-9a-f]{32}\.zip")
PLUGIN_MUTATION_STATES = {"in_progress", "completed_restart_required", "failed"}
PLUGIN_TERMINAL_STATES = {"completed_restart_required", "failed"}
ANDROID_PACKAGE_PATTERN = re.compile(r"[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+")
ANDROID_COMPONENT_PATTERN = re.compile(r"([A-Za-z0-9_.$]+)/([A-Za-z0-9_.$]+)")
CASE_FINGERPRINT_PATTERN = re.compile(r"[0-9a-f]{64}")
REQUIRED_DOCTOR_PERMISSIONS = frozenset(
    {"adb", "float", "background", "powerSave", "accessibility"}
)
STARTUP_LAUNCH_STATES = {"COLD", "WARM", "HOT"}
STARTUP_TIME_FIELDS = ("LaunchState", "Activity", "ThisTime", "TotalTime", "WaitTime")
PERFORMANCE_CSV_MAX_FILES = 512
PERFORMANCE_CSV_MAX_FILE_BYTES = 64 * 1024 * 1024
PERFORMANCE_CSV_MAX_TOTAL_BYTES = 256 * 1024 * 1024
PERFORMANCE_CSV_MAX_COLUMNS = 512
CLI_UI_ONLY_CONFIG_REASONS = {
    "KEY_PERFORMANCE_UPLOAD": "性能数据外发地址必须在 SoloPi App 中由用户核对",
    "KEY_RECORD_SCREEN_UPLOAD": "录屏数据外发地址必须在 SoloPi App 中由用户核对",
    "KEY_PATCH_URL": "远程插件源可下载并加载代码，只允许用户在 SoloPi App 中配置",
    "KEY_ADB_SERVER": "内部 ADB 目标地址只允许用户在 SoloPi App 中配置",
}

ACTION_CODE_TO_ENUM = {
    "cancel": "CANCEL",
    "click": "CLICK",
    "longClick": "LONG_CLICK",
    "input": "INPUT",
    "multiClick": "MULTI_CLICK",
    "clickIfExists": "CLICK_IF_EXISTS",
    "clickQuick": "CLICK_QUICK",
    "clickAndInput": "CLICK_AND_INPUT",
    "inputSearch": "INPUT_SEARCH",
    "scrollToBottom": "SCROLL_TO_BOTTOM",
    "scrollToTop": "SCROLL_TO_TOP",
    "scrollToRight": "SCROLL_TO_RIGHT",
    "scrollToLeft": "SCROLL_TO_LEFT",
    "gesture": "GESTURE",
    "assert": "ASSERT",
    "sleepUntil": "SLEEP_UNTIL",
    "otherNode": "OTHER_NODE",
    "back": "BACK",
    "reload": "RELOAD",
    "handleAlert": "HANDLE_ALERT",
    "jumpToPage": "JUMP_TO_PAGE",
    "changeMode": "CHANGE_MODE",
    "generateQrCode": "GENERATE_QR_CODE",
    "generateBarCode": "GENERATE_BAR_CODE",
    "globalScrollToBottom": "GLOBAL_SCROLL_TO_BOTTOM",
    "globalScrollToTop": "GLOBAL_SCROLL_TO_TOP",
    "globalScrollToRight": "GLOBAL_SCROLL_TO_RIGHT",
    "globalScrollToLeft": "GLOBAL_SCROLL_TO_LEFT",
    "keyboardInput": "KEYBOARD_INPUT",
    "inputGlobal": "INPUT_GLOBAL",
    "globalPinchOut": "GLOBAL_PINCH_OUT",
    "globalPinchIn": "GLOBAL_PINCH_IN",
    "globalGesture": "GLOBAL_GESTURE",
    "goToIndex": "GOTO_INDEX",
    "clearData": "CLEAR_DATA",
    "assertToast": "ASSERT_TOAST",
    "killProcess": "KILL_PROCESS",
    "sleep": "SLEEP",
    "screenshot": "SCREENSHOT",
    "home": "HOME",
    "notification": "NOTIFICATION",
    "recentTask": "RECENT_TASK",
    "deviceInfo": "DEVICE_INFO",
    "executeShell": "EXECUTE_SHELL",
    "pause": "PAUSE",
    "resume": "RESUME",
    "otherGlobal": "OTHER_GLOBAL",
    "finish": "FINISH",
    "focus": "FOCUS",
    "letNode": "LET_NODE",
    "let": "LET",
    "load": "LOAD_PARAM",
    "checkNode": "CHECK_NODE",
    "check": "CHECK",
    "forceStop": "FORCE_STOP",
    "slaveExit": "NORMAL_EXIT",
    "permissionAlert": "HANDLE_PERMISSION_ALERT",
    "inputMethod": "HIDE_INPUT_METHOD",
    "while": "WHILE",
    "if": "IF",
    "continue": "CONTINUE",
    "break": "BREAK",
}
CASE_ONLY_ACTION_CODE_TO_ENUM = {
    "deleteCase": "DELETE_CASE",
    "exportCase": "EXPORT_CASE",
    "playMultiTimes": "PLAY_MULTI_TIMES",
    "genMultiParam": "GEN_MULTI_PARAM",
}
ACTION_ENUMS = set(ACTION_CODE_TO_ENUM.values())
RUNTIME_ONLY_ACTION_ENUMS = {
    "CANCEL",
    "FOCUS",
    "FINISH",
    "PAUSE",
    "RESUME",
    "FORCE_STOP",
    "NORMAL_EXIT",
}
INTERNAL_ACTION_ENUMS = {
    "HANDLE_PERMISSION_ALERT",
    "HIDE_INPUT_METHOD",
    "WHILE",
    "IF",
    "CONTINUE",
    "BREAK",
}
DYNAMIC_PROVIDER_ACTION_ENUMS = {"OTHER_NODE", "OTHER_GLOBAL"}
NODE_ACTION_ENUMS = {
    "CLICK",
    "LONG_CLICK",
    "INPUT",
    "MULTI_CLICK",
    "CLICK_IF_EXISTS",
    "CLICK_QUICK",
    "CLICK_AND_INPUT",
    "INPUT_SEARCH",
    "SCROLL_TO_BOTTOM",
    "SCROLL_TO_TOP",
    "SCROLL_TO_RIGHT",
    "SCROLL_TO_LEFT",
    "GESTURE",
    "ASSERT",
    "SLEEP_UNTIL",
    "OTHER_NODE",
    "LET_NODE",
    "CHECK_NODE",
}
NODE_SELECTOR_FIELDS = ("resourceId", "text", "description", "xpath", "id")
REQUIRED_ACTION_PARAMS = {
    "INPUT": {"text"},
    "CLICK_AND_INPUT": {"text"},
    "INPUT_SEARCH": {"text"},
    "LONG_CLICK": {"text"},
    "MULTI_CLICK": {"text"},
    "SLEEP_UNTIL": {"text"},
    "SCROLL_TO_BOTTOM": {"text"},
    "SCROLL_TO_TOP": {"text"},
    "SCROLL_TO_RIGHT": {"text"},
    "SCROLL_TO_LEFT": {"text"},
    "SLEEP": {"text"},
    "SCREENSHOT": {"text"},
    "JUMP_TO_PAGE": {"scheme"},
    "GENERATE_QR_CODE": {"scheme"},
    "GENERATE_BAR_CODE": {"scheme"},
    "KEYBOARD_INPUT": {"text"},
    "INPUT_GLOBAL": {"text"},
    "EXECUTE_SHELL": {"text"},
    "ASSERT": {"assertMode", "assertInputContent"},
    "ASSERT_TOAST": {"assertMode", "assertInputContent"},
    "GESTURE": {"gesturePath", "gestureFilter"},
    "GLOBAL_GESTURE": {"gesturePath", "gestureFilter"},
    "LET_NODE": {"allocType", "allocValue", "allocKey"},
    "LET": {"allocType", "allocValue", "allocKey"},
    "LOAD_PARAM": {"appUrl"},
    "CHANGE_MODE": {"descriptorMode"},
    "CHECK_NODE": {"check"},
    "CHECK": {"check"},
    "IF": {"check"},
    "WHILE": {"check"},
    "OTHER_NODE": {"targetAction"},
    "OTHER_GLOBAL": {"targetAction"},
}
CASE_STEP_ACTION_ENUMS = ACTION_ENUMS - RUNTIME_ONLY_ACTION_ENUMS
PROHIBITED_AUTHORING_ACTION_ENUMS = {
    "EXECUTE_SHELL",
    "HANDLE_PERMISSION_ALERT",
    "HIDE_INPUT_METHOD",
}
PROHIBITED_AUTHORING_ACTION_REASONS = {
    "EXECUTE_SHELL": "历史任意 Shell 动作只允许查看",
    "HANDLE_PERMISSION_ALERT": "权限弹窗处理是 SoloPi 内部运行时动作，可能自动确认系统权限",
    "HIDE_INPUT_METHOD": "隐藏输入法是 SoloPi 内部运行时动作",
}
HIGH_RISK_ACTION_REASONS = {
    "CLEAR_DATA": "会清除目标应用数据",
    "KILL_PROCESS": "会停止目标应用进程",
    "JUMP_TO_PAGE": "会打开深链或外部页面",
    "EXECUTE_SHELL": "历史任意 Shell 动作只允许查看，禁止新增或复制",
}
PROVIDER_ACTIONS = (
    ("clickByScreenshot", "OTHER_NODE", True),
    ("assertScreenshot", "OTHER_NODE", True),
    ("startRecord", "OTHER_GLOBAL", False),
    ("stopRecord", "OTHER_GLOBAL", False),
    ("startRecordScreen", "OTHER_GLOBAL", False),
    ("stopRecordScreen", "OTHER_GLOBAL", False),
)
PROVIDER_ACTION_BY_CODE = {
    code: {"actionEnum": action_enum, "requiresNode": requires_node}
    for code, action_enum, requires_node in PROVIDER_ACTIONS
}
PROVIDER_ACTION_REQUIRED_PARAMS = {
    "clickByScreenshot": {"targetAction", "targetImage"},
    "assertScreenshot": {"targetAction", "targetImage"},
    "startRecord": {"targetAction", "checkList"},
    "stopRecord": {"targetAction"},
    "startRecordScreen": {
        "targetAction",
        "resolution",
        "INTENT_VIDEO_BITRATE",
        "INTENT_FRAME_RATE",
        "INTENT_EXCEPT_DIFF",
    },
    "stopRecordScreen": {"targetAction"},
}
PROVIDER_ACTION_OPTIONAL_PARAMS = {
    "clickByScreenshot": ["originSize", "originPos"],
    "assertScreenshot": ["originSize", "originPos"],
    "startRecord": ["url"],
    "startRecordScreen": ["url", "title"],
}
PROVIDER_ACTION_PRIOR_ACTION = {
    "stopRecord": "startRecord",
    "stopRecordScreen": "startRecordScreen",
}
PROVIDER_REQUIRED_PLUGIN = {
    "clickByScreenshot": "hulu_imageCompare",
    "assertScreenshot": "hulu_imageCompare",
    "startRecordScreen": "hulu_screenRecord",
    "stopRecordScreen": "hulu_screenRecord",
}


def action_catalog() -> List[Dict[str, Any]]:
    """返回与 PerformActionEnum 一一对应的可机读动作目录。"""
    catalog: List[Dict[str, Any]] = []
    all_actions = list(ACTION_CODE_TO_ENUM.items()) + list(
        CASE_ONLY_ACTION_CODE_TO_ENUM.items()
    )
    for code, action_enum in all_actions:
        case_only = action_enum in CASE_ONLY_ACTION_CODE_TO_ENUM.values()
        internal = action_enum in INTERNAL_ACTION_ENUMS
        dynamic_provider = action_enum in DYNAMIC_PROVIDER_ACTION_ENUMS
        runtime_only = action_enum in RUNTIME_ONLY_ACTION_ENUMS
        if case_only:
            authoring = "case-only"
        elif internal:
            authoring = "case-context"
        elif dynamic_provider:
            authoring = "dynamic-provider"
        elif runtime_only:
            authoring = "runtime-only"
        else:
            authoring = "case-step"
        catalog.append(
            {
                "code": code,
                "actionEnum": action_enum,
                "authoring": authoring,
                "caseOnly": case_only,
                "internal": internal,
                "dynamicProvider": dynamic_provider,
                "runtimeOnly": runtime_only,
                "requiresCaseContext": internal,
                "supportedInCaseStep": action_enum in CASE_STEP_ACTION_ENUMS,
                "authoringAllowed": (
                    action_enum in CASE_STEP_ACTION_ENUMS
                    and action_enum not in PROHIBITED_AUTHORING_ACTION_ENUMS
                ),
                "highRisk": action_enum in HIGH_RISK_ACTION_REASONS,
                "highRiskReason": HIGH_RISK_ACTION_REASONS.get(action_enum),
                "requiresHighRiskConfirmation": action_enum in HIGH_RISK_ACTION_REASONS,
                "requiresNode": action_enum in NODE_ACTION_ENUMS,
                "requiredParams": sorted(REQUIRED_ACTION_PARAMS.get(action_enum, set())),
            }
        )
    return catalog


def provider_action_catalog() -> List[Dict[str, Any]]:
    catalog: List[Dict[str, Any]] = []
    for code, action_enum, requires_node in PROVIDER_ACTIONS:
        descriptor: Dict[str, Any] = {
            "code": code,
            "targetAction": code,
            "actionEnum": action_enum,
            "authoring": "dynamic-provider",
            "caseOnly": False,
            "internal": False,
            "dynamicProvider": True,
            "runtimeAvailabilityUnknown": True,
            "supportedInCaseStep": True,
            "requiresNode": requires_node,
            "requiredParams": sorted(PROVIDER_ACTION_REQUIRED_PARAMS[code]),
            "optionalParams": PROVIDER_ACTION_OPTIONAL_PARAMS.get(code, []),
        }
        if code in PROVIDER_ACTION_PRIOR_ACTION:
            descriptor["requiresPriorAction"] = PROVIDER_ACTION_PRIOR_ACTION[code]
        catalog.append(descriptor)
    return catalog


class CliError(Exception):
    def __init__(self, message: str, exit_code: int = 3, **details: Any) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.details = details


class ChineseHelpFormatter(argparse.HelpFormatter):
    def _format_usage(
        self,
        usage: Optional[str],
        actions: Sequence[argparse.Action],
        groups: Sequence[Any],
        prefix: Optional[str],
    ) -> str:
        formatted = super()._format_usage(usage, actions, groups, prefix)
        return formatted.replace("usage: ", "用法：", 1)


class ChineseArgumentParser(argparse.ArgumentParser):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs.setdefault("formatter_class", ChineseHelpFormatter)
        super().__init__(*args, **kwargs)
        self._positionals.title = "位置参数"
        self._optionals.title = "选项"
        for action in self._actions:
            if action.dest == "help":
                action.help = "显示帮助并退出"


def positive_float(raw_value: str) -> float:
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("必须是数字") from exc
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("必须是大于零的有限数字")
    return value


def positive_int(raw_value: str) -> int:
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("必须是整数") from exc
    if value <= 0:
        raise argparse.ArgumentTypeError("必须大于零")
    return value


def non_negative_int(raw_value: str) -> int:
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("必须是整数") from exc
    if value < 0:
        raise argparse.ArgumentTypeError("必须大于等于零")
    return value


def video_action_offset_ms(raw_value: str) -> int:
    value = non_negative_int(raw_value)
    if value > VIDEO_ANALYSIS_MAX_ACTION_OFFSET_MS:
        raise argparse.ArgumentTypeError(
            "必须在 0 到 %d 毫秒之间" % VIDEO_ANALYSIS_MAX_ACTION_OFFSET_MS
        )
    return value


def video_difference_threshold(raw_value: str) -> float:
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("必须是数字") from exc
    if not math.isfinite(value) or value <= 0 or value > 1:
        raise argparse.ArgumentTypeError("必须是大于 0 且不超过 1 的有限数字")
    return value


def non_negative_float(raw_value: str) -> float:
    try:
        value = float(raw_value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("必须是数字") from exc
    if not math.isfinite(value) or value < 0:
        raise argparse.ArgumentTypeError("必须是大于等于零的有限数字")
    return value


def require_positive_finite(value: float, label: str) -> None:
    if not math.isfinite(value) or value <= 0:
        raise CliError("%s 必须是大于零的有限数字" % label, 3)


@dataclass
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""
    stdout_bytes: bytes = b""


class CommandRunner:
    def run(self, args: Sequence[str], timeout: float = 30, binary: bool = False) -> CommandResult:
        try:
            completed = subprocess.run(
                list(args),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError as exc:
            raise CliError("找不到可执行程序：%s" % args[0], 3) from exc
        except subprocess.TimeoutExpired as exc:
            raise CliError("命令执行超时", 124, command=list(args)) from exc

        if binary:
            return CommandResult(
                completed.returncode,
                stderr=completed.stderr.decode("utf-8", errors="replace"),
                stdout_bytes=completed.stdout,
            )
        return CommandResult(
            completed.returncode,
            stdout=completed.stdout.decode("utf-8", errors="replace"),
            stderr=completed.stderr.decode("utf-8", errors="replace"),
        )

    def run_file_input(
        self, args: Sequence[str], input_path: Path, timeout: float = 120
    ) -> CommandResult:
        try:
            with Path(input_path).open("rb") as source:
                completed = subprocess.run(
                    list(args),
                    stdin=source,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=timeout,
                    check=False,
                )
        except FileNotFoundError as exc:
            raise CliError("找不到可执行程序：%s" % args[0], 3) from exc
        except subprocess.TimeoutExpired as exc:
            raise CliError("命令执行超时", 124, command=list(args)) from exc
        except OSError as exc:
            raise CliError("无法读取命令输入", 3, file=str(input_path)) from exc
        return CommandResult(
            completed.returncode,
            stdout=completed.stdout.decode("utf-8", errors="replace"),
            stderr=completed.stderr.decode("utf-8", errors="replace"),
        )


def parse_devices(output: str) -> List[Dict[str, str]]:
    devices: List[Dict[str, str]] = []
    for raw_line in output.splitlines()[1:]:
        line = raw_line.strip()
        if not line or line.startswith("*"):
            continue
        fields = line.split()
        if len(fields) < 2:
            continue
        item = {"serial": fields[0], "state": fields[1]}
        for field in fields[2:]:
            if ":" in field:
                key, value = field.split(":", 1)
                item[key] = value
        devices.append(item)
    return devices


def select_device(devices: Iterable[Dict[str, str]], requested: Optional[str]) -> Dict[str, str]:
    available = [item for item in devices if item.get("state") == "device"]
    if requested:
        for item in available:
            if item.get("serial") == requested:
                return item
        raise CliError("指定设备不在线", 3, serial=requested)
    if not available:
        raise CliError("未找到在线 Android 设备", 3)
    if len(available) > 1:
        raise CliError(
            "存在多台在线设备；请传入 --serial",
            3,
            devices=[item.get("serial") for item in available],
        )
    return available[0]


def validate_android_package(package_name: str) -> str:
    normalized = package_name.strip()
    if not ANDROID_PACKAGE_PATTERN.fullmatch(normalized):
        raise CliError("目标应用包名格式无效", 3, targetPackage=normalized)
    return normalized


def parse_android_component(raw_value: str, target_package: str) -> str:
    component = raw_value.strip()
    match = ANDROID_COMPONENT_PATTERN.fullmatch(component)
    if not match or match.group(1) != target_package:
        raise CliError(
            "无法解析目标应用的 Launcher Activity",
            4,
            targetPackage=target_package,
            component=component,
        )
    return component


def parse_startup_time_output(output: str, target_package: str) -> Dict[str, Any]:
    fields: Dict[str, str] = {}
    complete = False
    recognized = {"Status", *STARTUP_TIME_FIELDS}
    for raw_line in output.replace("\r\n", "\n").replace("\r", "\n").splitlines():
        line = raw_line.strip()
        if line == "Complete":
            complete = True
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if key not in recognized:
            continue
        if key in fields:
            raise CliError(
                "Activity Manager 启动结果包含重复字段",
                4,
                field=key,
                stdout=output.strip(),
            )
        fields[key] = value.strip()

    required_fields = ("Status", "LaunchState", "Activity", "TotalTime", "WaitTime")
    missing_fields = [key for key in required_fields if key not in fields]
    if missing_fields or not complete:
        raise CliError(
            "Activity Manager 启动结果字段不完整",
            4,
            missingFields=missing_fields,
            missingComplete=not complete,
            stdout=output.strip(),
        )
    if fields["Status"].lower() != "ok":
        raise CliError(
            "Activity Manager 报告应用启动失败",
            4,
            status=fields["Status"],
            stdout=output.strip(),
        )

    launch_state = fields["LaunchState"].upper()
    if launch_state not in STARTUP_LAUNCH_STATES:
        raise CliError(
            "Activity Manager 返回未知启动状态",
            4,
            launchState=fields["LaunchState"],
            stdout=output.strip(),
        )
    activity = parse_android_component(fields["Activity"], target_package)

    parsed: Dict[str, Any] = {
        "LaunchState": launch_state,
        "Activity": activity,
        # Android 16 可能完全省略 ThisTime；保持字段稳定，但不使用 TotalTime 伪造。
        "ThisTime": None,
    }
    numeric_fields = ["TotalTime", "WaitTime"]
    if "ThisTime" in fields:
        numeric_fields.insert(0, "ThisTime")
    for field in numeric_fields:
        raw_value = fields[field]
        try:
            value = int(raw_value)
        except ValueError as exc:
            raise CliError(
                "Activity Manager 启动耗时不是整数",
                4,
                field=field,
                value=raw_value,
                stdout=output.strip(),
            ) from exc
        if value < 0:
            raise CliError(
                "Activity Manager 启动耗时不能为负数",
                4,
                field=field,
                value=value,
                stdout=output.strip(),
            )
        parsed[field] = value

    this_time = parsed["ThisTime"]
    if (
        (this_time is not None and parsed["TotalTime"] < this_time)
        or parsed["WaitTime"] < parsed["TotalTime"]
    ):
        raise CliError(
            "Activity Manager 启动耗时字段关系无效",
            4,
            startupTime=parsed,
            stdout=output.strip(),
        )
    return parsed


def complete_activity_manager_blocks(output: str) -> List[str]:
    blocks: List[str] = []
    current: List[str] = []
    for raw_line in output.replace("\r\n", "\n").replace("\r", "\n").splitlines():
        current.append(raw_line)
        if raw_line.strip() == "Complete":
            blocks.append("\n".join(current))
            current = []
    if any(line.strip() for line in current):
        raise CliError(
            "Activity Manager 启动结果存在未完成片段",
            4,
            stdout=output.strip(),
        )
    return blocks


def startup_time_statistics(samples: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    if not samples:
        raise CliError("启动耗时统计至少需要一个有效样本", 4)
    result: Dict[str, Dict[str, Any]] = {}
    for field in ("ThisTime", "TotalTime", "WaitTime"):
        values = sorted(
            int(sample[field])
            for sample in samples
            if isinstance(sample.get(field), int) and not isinstance(sample.get(field), bool)
        )
        if not values:
            result[field] = {
                "available": False,
                "sampleCount": 0,
                "min": None,
                "max": None,
                "mean": None,
                "median": None,
                "p90": None,
            }
            continue
        p90_index = max(0, math.ceil(len(values) * 0.9) - 1)
        result[field] = {
            "available": True,
            "sampleCount": len(values),
            "min": values[0],
            "max": values[-1],
            "mean": round(sum(values) / len(values), 3),
            "median": round(float(statistics.median(values)), 3),
            "p90": values[p90_index],
        }
    return result


def build_scheme_uri(action: str, params: Dict[str, str]) -> str:
    query = urllib.parse.urlencode(params)
    suffix = "?" + query if query else ""
    return "solopi://startaction/%s%s" % (urllib.parse.quote(action, safe=""), suffix)


class AdbClient:
    def __init__(
        self,
        executable: str = "adb",
        requested_serial: Optional[str] = None,
        runner: Optional[CommandRunner] = None,
        control_package: str = DEFAULT_PACKAGE,
    ) -> None:
        self.executable = executable
        self.requested_serial = requested_serial
        self.runner = runner or CommandRunner()
        self.control_package = control_package
        self.device: Optional[Dict[str, str]] = None
        self._plugin_import_cleanup_allowlist: set[tuple[str, str]] = set()

    @property
    def serial(self) -> str:
        if self.device is None:
            self.connect()
        assert self.device is not None
        return self.device["serial"]

    def connect(self) -> Dict[str, str]:
        if self.requested_serial:
            result = self.runner.run(
                [self.executable, "-s", self.requested_serial, "get-state"],
                timeout=10,
            )
            if result.returncode != 0 or result.stdout.strip() != "device":
                raise CliError(
                    "指定设备不在线",
                    3,
                    serial=self.requested_serial,
                    stderr=result.stderr.strip(),
                )
            self.device = {"serial": self.requested_serial, "state": "device"}
            return self.device

        result = self.runner.run([self.executable, "devices", "-l"])
        if result.returncode != 0:
            raise CliError("无法列出 ADB 设备", 4, stderr=result.stderr.strip())
        self.device = select_device(parse_devices(result.stdout), self.requested_serial)
        return self.device

    def _base(self) -> List[str]:
        return [self.executable, "-s", self.serial]

    def shell(self, args: Sequence[str], timeout: float = 30) -> CommandResult:
        remote_command = shlex.join(list(args))
        return self.runner.run(self._base() + ["shell", remote_command], timeout=timeout)

    def exec_out(self, args: Sequence[str], timeout: float = 30) -> CommandResult:
        return self.runner.run(self._base() + ["exec-out"] + list(args), timeout=timeout, binary=True)

    def package_installed(self, package_name: str) -> bool:
        result = self.shell(["pm", "path", package_name])
        return result.returncode == 0 and result.stdout.strip().startswith("package:")

    def launch(self, package_name: str) -> None:
        result = self.shell(
            ["monkey", "-p", package_name, "-c", "android.intent.category.LAUNCHER", "1"],
            timeout=20,
        )
        if result.returncode != 0 or "No activities found" in result.stdout:
            raise CliError("无法启动 SoloPi", 4, stderr=result.stderr.strip())

    def foreground_component(self) -> Optional[str]:
        result = self.shell(["dumpsys", "window"], timeout=10)
        if result.returncode != 0:
            return None
        match = re.search(
            r"mCurrentFocus=Window\{[^\n}]*\s([A-Za-z0-9_.$]+/[A-Za-z0-9_.$]+)\}",
            result.stdout,
        )
        if match is None:
            return None
        component = match.group(1)
        return component if ANDROID_COMPONENT_PATTERN.fullmatch(component) else None

    def restore_foreground(self, component: Optional[str]) -> bool:
        if not isinstance(component, str) or not ANDROID_COMPONENT_PATTERN.fullmatch(component):
            return False
        result = self.shell(["am", "start", "-W", "-n", component], timeout=20)
        output = (result.stdout + "\n" + result.stderr).lower()
        errors = (
            "error:",
            "exception occurred while executing",
            "securityexception",
            "permission denial",
            "unable to resolve intent",
        )
        return result.returncode == 0 and not any(marker in output for marker in errors)

    def resolve_launcher_component(self, package_name: str) -> str:
        target_package = validate_android_package(package_name)
        attempts: List[Dict[str, Any]] = []
        commands = (
            [
                "cmd",
                "package",
                "resolve-activity",
                "--brief",
                "-a",
                "android.intent.action.MAIN",
                "-c",
                "android.intent.category.LAUNCHER",
                target_package,
            ],
            [
                "pm",
                "resolve-activity",
                "--brief",
                "-a",
                "android.intent.action.MAIN",
                "-c",
                "android.intent.category.LAUNCHER",
                target_package,
            ],
        )
        for command in commands:
            result = self.shell(command, timeout=15)
            candidates = []
            for raw_line in result.stdout.splitlines():
                candidate = raw_line.strip()
                match = ANDROID_COMPONENT_PATTERN.fullmatch(candidate)
                if match and match.group(1) == target_package:
                    candidates.append(candidate)
            candidates = list(dict.fromkeys(candidates))
            if result.returncode == 0 and len(candidates) == 1:
                return candidates[0]
            attempts.append(
                {
                    "command": command[:3],
                    "returnCode": result.returncode,
                    "stdout": result.stdout.strip(),
                    "stderr": result.stderr.strip(),
                }
            )
        raise CliError(
            "无法解析目标应用的 Launcher Activity",
            4,
            targetPackage=target_package,
            attempts=attempts,
        )

    def measure_startup_time(
        self,
        component: str,
        target_package: str,
        mode: str,
        timeout: float,
    ) -> Dict[str, Any]:
        parse_android_component(component, target_package)
        command = ["am", "start", "-W"]
        if mode == "cold":
            command.append("-S")
        elif mode == "warm":
            command.extend(["-R", "2"])
        else:
            raise CliError("启动模式必须是 cold 或 warm", 3, mode=mode)
        command.extend(["-n", component])
        result = self.shell(command, timeout=timeout)
        combined_output = (result.stdout + "\n" + result.stderr).lower()
        error_markers = (
            "error:",
            "error type ",
            "exception occurred while executing",
            "securityexception",
            "security exception",
            "permission denial",
            "unable to resolve intent",
        )
        if result.returncode != 0 or any(marker in combined_output for marker in error_markers):
            raise CliError(
                "Activity Manager 启动应用失败",
                4,
                targetPackage=target_package,
                component=component,
                mode=mode,
                returnCode=result.returncode,
                stdout=result.stdout.strip(),
                stderr=result.stderr.strip(),
            )
        try:
            if mode == "warm":
                blocks = complete_activity_manager_blocks(result.stdout)
                if len(blocks) != 2:
                    raise CliError(
                        "Activity Manager 暖启动没有返回两段完整结果",
                        4,
                        resultCount=len(blocks),
                        stdout=result.stdout.strip(),
                    )
                return parse_startup_time_output(blocks[-1], target_package)
            return parse_startup_time_output(result.stdout, target_package)
        except CliError as exc:
            exc.details.setdefault("stderr", result.stderr.strip())
            raise

    def invoke_scheme(
        self,
        action: str,
        params: Dict[str, str],
        timeout: float = 30,
    ) -> str:
        uri = build_scheme_uri(action, params)
        control_package = validate_android_package(self.control_package)
        component = "%s/%s" % (control_package, ADB_SCHEME_ACTIVITY)
        result = self.shell(
            [
                "am",
                "start",
                "-W",
                "-n",
                component,
                "-a",
                "android.intent.action.VIEW",
                "-d",
                uri,
            ],
            timeout=timeout,
        )
        activity_output = (result.stdout + "\n" + result.stderr).lower()
        activity_errors = (
            "error:",
            "error type ",
            "exception occurred while executing",
            "securityexception",
            "security exception",
            "permission denial",
            "unable to resolve intent",
        )
        if result.returncode != 0 or any(marker in activity_output for marker in activity_errors):
            raise CliError(
                "SoloPi Scheme 命令执行失败",
                4,
                action=action,
                stdout=result.stdout.strip(),
                stderr=result.stderr.strip(),
            )
        return uri

    def forward(self, local_port: int, device_port: int) -> int:
        local_spec = "tcp:%d" % local_port
        result = self.runner.run(
            self._base() + ["forward", local_spec, "tcp:%d" % device_port],
            timeout=10,
        )
        if result.returncode != 0:
            raise CliError("无法转发 SoloPi 控制端口", 4, stderr=result.stderr.strip())
        if local_port == 0:
            try:
                return int(result.stdout.strip())
            except ValueError as exc:
                raise CliError("ADB 未返回已分配的本地端口", 4) from exc
        return local_port

    def remove_forward(self, local_port: int) -> None:
        self.runner.run(self._base() + ["forward", "--remove", "tcp:%d" % local_port], timeout=10)

    def screenshot(self) -> bytes:
        result = self.exec_out(["screencap", "-p"], timeout=30)
        if result.returncode != 0 or not result.stdout_bytes.startswith(b"\x89PNG"):
            raise CliError("无法获取设备截图", 4, stderr=result.stderr.strip())
        return result.stdout_bytes

    def _screen_recording_file_size(
        self,
        remote_path: str,
        captures_root: str,
    ) -> int:
        """只检查已验证 capturesRoot 下的精确录屏文件。"""
        validate_screen_record_output_path(remote_path, captures_root)
        regular_file = self.shell(["test", "-f", remote_path], timeout=10)
        if regular_file.returncode != 0:
            raise CliError(
                "录屏输出不是设备端文件",
                4,
                outputPath=remote_path,
            )
        result = self.shell(["stat", "-c", "%s", remote_path], timeout=10)
        raw_size = result.stdout.strip()
        try:
            size = int(raw_size)
        except ValueError as exc:
            raise CliError(
                "无法读取录屏文件大小",
                4,
                outputPath=remote_path,
            ) from exc
        if result.returncode != 0 or size <= 0:
            raise CliError(
                "设备端录屏文件为空",
                4,
                outputPath=remote_path,
                sizeBytes=size,
            )
        return size

    def logcat(self) -> str:
        result = self.runner.run(self._base() + ["logcat", "-d", "-v", "threadtime"], timeout=30)
        if result.returncode != 0:
            raise CliError("无法读取 logcat", 4, stderr=result.stderr.strip())
        return result.stdout

    def processor_count(self) -> int:
        """读取设备在线 CPU 数；不向调用者开放任意 shell。"""
        attempts: List[Dict[str, Any]] = []
        for command in (["getconf", "_NPROCESSORS_ONLN"], ["nproc"]):
            result = self.shell(command, timeout=10)
            raw_value = result.stdout.strip()
            try:
                value = int(raw_value)
            except ValueError:
                value = 0
            if result.returncode == 0 and value > 0:
                return value
            attempts.append(
                {
                    "command": command,
                    "returncode": result.returncode,
                    "stdout": raw_value,
                    "stderr": result.stderr.strip(),
                }
            )
        raise CliError("无法确定设备处理器数量", 4, attempts=attempts)

    def make_directory(self, remote_path: str) -> None:
        result = self.shell(["mkdir", "-p", remote_path], timeout=20)
        if result.returncode != 0:
            raise CliError("无法创建设备端导入目录", 4, stderr=result.stderr.strip())

    def push(self, local_path: Path, remote_path: str) -> None:
        result = self.runner.run(
            self._base() + ["push", str(local_path), remote_path],
            timeout=60,
        )
        if result.returncode != 0:
            raise CliError("无法将用例推送到设备", 4, stderr=result.stderr.strip())

    def _push_plugin_import(
        self,
        local_path: Path,
        import_path: str,
        file_name: str,
    ) -> None:
        """推送一个受控插件包，并只为该精确目标登记清理权限。"""
        canonical_root = validate_plugin_import_path(import_path)
        safe_name = validate_generated_plugin_file_name(file_name)
        remote_path = str(PurePosixPath(canonical_root) / safe_name)
        cleanup_key = (canonical_root, safe_name)
        self._plugin_import_cleanup_allowlist.add(cleanup_key)
        try:
            self.push(local_path, remote_path)
        except CliError as exc:
            raise CliError(
                "无法将插件包推送到设备",
                exc.exit_code,
                **exc.details,
            ) from exc

    def _remove_whitelisted_plugin_import(
        self,
        import_path: str,
        file_name: str,
    ) -> Dict[str, Any]:
        """只删除当前受控推送登记的、导入目录下的精确直接子文件。"""
        canonical_root = validate_plugin_import_path(import_path)
        safe_name = validate_generated_plugin_file_name(file_name)
        cleanup_key = (canonical_root, safe_name)
        if cleanup_key not in self._plugin_import_cleanup_allowlist:
            raise CliError(
                "插件导入文件未登记清理",
                4,
                fileName=safe_name,
            )

        remote_path = str(PurePosixPath(canonical_root) / safe_name)
        evidence: Dict[str, Any] = {
            "attempted": True,
            "success": False,
            "removed": False,
            "fileName": safe_name,
        }
        try:
            removal = self.shell(["rm", "-f", "--", remote_path], timeout=20)
            if removal.returncode != 0:
                evidence.update(
                    {
                        "reason": "remove_failed",
                        "returnCode": removal.returncode,
                    }
                )
                return evidence
            verification = self.shell(["test", "!", "-e", remote_path], timeout=10)
            if verification.returncode != 0:
                evidence.update(
                    {
                        "reason": "file_still_present",
                        "returnCode": verification.returncode,
                    }
                )
                return evidence
            evidence.update({"success": True, "removed": True})
            return evidence
        finally:
            self._plugin_import_cleanup_allowlist.discard(cleanup_key)

    def pull(self, remote_path: str, local_path: Path) -> None:
        try:
            result = self.runner.run(
                self._base() + ["pull", remote_path, str(local_path)],
                timeout=120,
            )
        except CliError as exc:
            if exc.exit_code == 124:
                raise CliError(
                    "拉取性能数据超时",
                    124,
                    remotePath=remote_path,
                    localPath=str(local_path),
                ) from exc
            raise
        if result.returncode != 0:
            raise CliError(
                "无法从设备拉取性能数据",
                4,
                remotePath=remote_path,
                localPath=str(local_path),
                stderr=result.stderr.strip(),
            )


class HarnessHttpClient:
    def __init__(self, port: int, timeout: float = 5) -> None:
        self.base_url = "http://127.0.0.1:%d" % port
        self.timeout = timeout

    def get(
        self,
        action: str,
        params: Dict[str, str],
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        query = urllib.parse.urlencode(params)
        url = "%s/scheme/%s" % (self.base_url, urllib.parse.quote(action, safe=""))
        if query:
            url += "?" + query
        try:
            with urllib.request.urlopen(
                url,
                timeout=self.timeout if timeout is None else timeout,
            ) as response:
                payload = response.read().decode("utf-8")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise CliError("无法连接 SoloPi 控制服务", 4, url=url) from exc
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise CliError("SoloPi 返回的 JSON 无效", 4, url=url, response=payload[:500]) from exc
        if not isinstance(parsed, dict):
            raise CliError("SoloPi 返回的响应不是对象", 4, url=url)
        return parsed


class HarnessSession:
    def __init__(
        self,
        adb: AdbClient,
        package_name: str,
        device_port: int,
        local_port: int,
        request_timeout: float,
        startup_timeout: float,
        preserve_foreground: bool = False,
    ) -> None:
        self.adb = adb
        self.package_name = package_name
        self.device_port = device_port
        self.requested_local_port = local_port
        self.request_timeout = request_timeout
        self.startup_timeout = startup_timeout
        self.preserve_foreground = preserve_foreground
        self.local_port: Optional[int] = None
        self.http: Optional[HarnessHttpClient] = None

    def __enter__(self) -> "HarnessSession":
        self.adb.connect()
        if not self.adb.package_installed(self.package_name):
            raise CliError("所选设备未安装 SoloPi", 3, package=self.package_name)
        foreground = self.adb.foreground_component() if self.preserve_foreground else None
        self.adb.launch(self.package_name)
        self.local_port = self.adb.forward(self.requested_local_port, self.device_port)
        self.http = HarnessHttpClient(self.local_port, self.request_timeout)
        try:
            self.wait_until_available()
        except Exception:
            self.adb.remove_forward(self.local_port)
            self.local_port = None
            if foreground:
                self.adb.restore_foreground(foreground)
            raise
        if foreground:
            self.adb.restore_foreground(foreground)
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        if self.local_port is not None:
            self.adb.remove_forward(self.local_port)

    def wait_until_available(self) -> None:
        assert self.http is not None
        deadline = time.monotonic() + self.startup_timeout
        last_error: Optional[Exception] = None
        while time.monotonic() < deadline:
            try:
                response = self.http.get("harness", {"type": "capabilities"})
                if response.get("success"):
                    return
            except CliError as exc:
                last_error = exc
            time.sleep(0.4)
        raise CliError(
            "SoloPi 控制服务未能就绪",
            4,
            lastError=str(last_error) if last_error else None,
        )

    def query(
        self,
        query_type: str,
        params: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        query_params = {"type": query_type}
        if params:
            query_params.update(params)
        return self.http.get("harness", query_params, timeout=timeout)

    def resolver_get(
        self,
        action: str,
        params: Dict[str, str],
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        return self.http.get(action, params, timeout=timeout)

    def inspect_page(self) -> Dict[str, Any]:
        return self.resolver_get("status", {"type": "page"})

    def agent(
        self,
        query_type: str,
        params: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        query_params = {"type": query_type}
        if params:
            query_params.update(params)
        return self.resolver_get("agent", query_params, timeout=timeout)

    def adb_connect_status(
        self,
        request_id: str,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        return self.query(
            "adb-connect-status", {"requestId": request_id}, timeout=timeout
        )

    def performance(
        self,
        mode: str,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        return self.http.get("performance", {"mode": mode}, timeout=timeout)

    def performance_display(
        self,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        return self.http.get(
            "performance",
            {"mode": "display", "action": "status"},
            timeout=timeout,
        )

    def config(
        self,
        action: str,
        key: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        params = {"action": action}
        if key is not None:
            params["key"] = key
        return self.http.get("config", params, timeout=timeout)

    def record(
        self,
        mode: str,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        return self.http.get("record", {"recordMode": mode}, timeout=timeout)

    def screen_record(
        self,
        action: str,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        return self.http.get("screen-record", {"action": action}, timeout=timeout)

    def scan(
        self,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        return self.http.get("scan", {"action": "status"}, timeout=timeout)

    def video_analysis(
        self,
        request_id: str,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        return self.http.get(
            "video-analysis",
            {"action": "status", "requestId": request_id},
            timeout=timeout,
        )

    def stress(
        self,
        action: str,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        return self.http.get("stress", {"action": action}, timeout=timeout)

    def history(
        self,
        action: str,
        params: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        query = {"action": action}
        if params:
            query.update(params)
        return self.http.get("history", query, timeout=timeout)

    def plugin(
        self,
        action: str,
        params: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        assert self.http is not None
        query = {"action": action}
        if params:
            query.update(params)
        return self.http.get("plugin", query, timeout=timeout)


def wait_for_new_run(
    session: HarnessSession,
    request_id: str,
    previous_run_id: Optional[str],
    case_name: str,
    timeout: float,
    poll_interval: float,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Dict[str, Any]:
    deadline = clock() + timeout
    while clock() < deadline:
        status = session.query("status")
        if status.get("requestId") == request_id:
            if status.get("caseName") != case_name:
                raise CliError(
                    "SoloPi 确认的回放请求对应其他用例",
                    4,
                    requestId=request_id,
                    status=status,
                )
            return status
        if status.get("runId") != previous_run_id:
            raise CliError(
                "其他回放先于当前请求取得设备",
                2,
                requestId=request_id,
                activeRun=status,
            )
        sleep(poll_interval)
    raise CliError(
        "SoloPi 未确认回放请求",
        124,
        caseName=case_name,
        requestId=request_id,
    )


def wait_for_terminal_run(
    session: HarnessSession,
    run_id: str,
    timeout: float,
    poll_interval: float,
) -> Dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_status: Optional[Dict[str, Any]] = None
    while time.monotonic() < deadline:
        last_status = session.query("status")
        if last_status.get("runId") != run_id:
            raise CliError("Harness 运行已被其他回放替换", 2, expectedRunId=run_id)
        if last_status.get("state") in TERMINAL_STATES:
            return last_status
        time.sleep(poll_interval)
    raise CliError("回放超时", 124, runId=run_id, lastStatus=last_status)


def normalize_performance_items(raw_items: str) -> List[str]:
    items: List[str] = []
    seen = set()
    for raw_item in raw_items.split(","):
        item = raw_item.strip()
        if item and item not in seen:
            seen.add(item)
            items.append(item)
    if not items:
        raise CliError("至少需要一个性能指标", 3)
    return items


def performance_display_session_id(raw_value: str) -> str:
    value = require_non_blank(raw_value, "性能浮窗 sessionId")
    if PERFORMANCE_DISPLAY_SESSION_ID_PATTERN.fullmatch(value) is None:
        raise CliError(
            "性能浮窗 sessionId 无效",
            3,
            sessionId=value,
        )
    return value


def performance_item_keys(response: Dict[str, Any]) -> List[str]:
    validate_performance_envelope(response)
    if not response["success"]:
        raise CliError(
            "SoloPi 性能指标不可用",
            2,
            response=response,
        )
    raw_items = response.get("items")
    if not isinstance(raw_items, list):
        raise CliError("SoloPi 返回的性能指标列表无效", 4)
    keys: List[str] = []
    for raw_item in raw_items:
        if (
            not isinstance(raw_item, dict)
            or not isinstance(raw_item.get("key"), str)
            or not raw_item["key"]
        ):
            raise CliError("SoloPi 返回的性能指标无效", 4)
        keys.append(raw_item["key"])
    return keys


def validate_performance_envelope(response: Dict[str, Any]) -> None:
    if not isinstance(response.get("success"), bool):
        raise CliError("SoloPi 返回的性能响应无效", 4, response=response)


def is_control_server_unreachable(error: CliError) -> bool:
    return (
        error.exit_code == 4
        and str(error)
        in {
            "Unable to reach SoloPi control server",
            "无法连接 SoloPi 控制服务",
        }
        and isinstance(error.details.get("url"), str)
    )


def validate_performance_status(response: Dict[str, Any]) -> None:
    validate_performance_envelope(response)
    if not response["success"]:
        return
    state = response.get("state")
    if state not in PERFORMANCE_STATES:
        raise CliError("SoloPi 返回的性能状态无效", 4, response=response)
    expected_flags = {
        "active": state in PERFORMANCE_ACTIVE_STATES,
        "terminal": state in PERFORMANCE_TERMINAL_STATES,
        "recording": state == "recording",
    }
    if any(response.get(key) is not value for key, value in expected_flags.items()):
        raise CliError("SoloPi 返回的性能状态标记不一致", 4, response=response)
    current_session_id = response.get("sessionId")
    if state != "idle" and (
        not isinstance(current_session_id, str) or not current_session_id
    ):
        raise CliError("SoloPi 返回的性能 sessionId 无效", 4, response=response)
    stop_retryable = response.get("stopRetryable")
    if stop_retryable is not None and not isinstance(stop_retryable, bool):
        raise CliError("SoloPi 返回的 stopRetryable 标记无效", 4, response=response)
    if stop_retryable is True and state != "stopping":
        raise CliError("SoloPi 返回的 stopRetryable 标记不一致", 4, response=response)


def wait_for_performance_state(
    session: HarnessSession,
    session_id: str,
    target_states: Iterable[str],
    timeout: float,
    poll_interval: float,
    operation: str,
    ignored_session_id: Optional[str] = None,
    allow_ignored_session: bool = False,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    on_status: Optional[Callable[[Dict[str, Any]], None]] = None,
    retry_unreachable: bool = False,
) -> Dict[str, Any]:
    require_positive_finite(timeout, "性能操作超时")
    require_positive_finite(poll_interval, "性能状态轮询间隔")
    expected_states = set(target_states)
    deadline = clock() + timeout
    last_status: Optional[Dict[str, Any]] = None
    last_transport_error: Optional[Dict[str, Any]] = None
    seen_expected_session = False
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            break
        configured_request_timeout = getattr(session, "request_timeout", remaining)
        request_timeout = min(remaining, configured_request_timeout)
        try:
            last_status = session.performance("status", timeout=request_timeout)
        except CliError as exc:
            if not retry_unreachable or not is_control_server_unreachable(exc):
                raise
            last_transport_error = {
                "error": str(exc),
                **exc.details,
            }
            remaining = deadline - clock()
            if remaining > 0:
                sleep(min(poll_interval, remaining))
            continue
        validate_performance_status(last_status)
        if not last_status["success"]:
            raise CliError(
                "无法查询 SoloPi 性能状态",
                2,
                response=last_status,
            )
        current_session_id = last_status.get("sessionId")
        if current_session_id == session_id:
            seen_expected_session = True
            if last_status.get("state") in expected_states:
                return last_status
            if on_status is not None:
                on_status(last_status)
        elif (
            seen_expected_session
            or not allow_ignored_session
            or current_session_id != ignored_session_id
        ):
            raise CliError(
                "性能会话已被其他录制替换",
                2,
                expectedSessionId=session_id,
                latestPerformance=last_status,
            )
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(poll_interval, remaining))
    raise CliError(
        "性能操作 %s 超时" % operation,
        124,
        sessionId=session_id,
        lastStatus=last_status,
        lastTransportError=last_transport_error,
    )


def validate_owned_session_status(
    response: Dict[str, Any],
    label: str,
    states: Iterable[str],
    active_states: Iterable[str],
    terminal_states: Iterable[str],
) -> None:
    if not isinstance(response.get("success"), bool):
        raise CliError("SoloPi 返回的%s响应无效" % label, 4, response=response)
    if not response["success"]:
        return
    state = response.get("state")
    state_set = set(states)
    active_state_set = set(active_states)
    terminal_state_set = set(terminal_states)
    if state not in state_set:
        raise CliError("SoloPi 返回的%s状态无效" % label, 4, response=response)
    expected_flags = {
        "active": state in active_state_set,
        "terminal": state in terminal_state_set,
    }
    if any(response.get(key) is not value for key, value in expected_flags.items()):
        raise CliError(
            "SoloPi 返回的%s状态标记不一致" % label,
            4,
            response=response,
        )
    session_id = response.get("sessionId")
    if state != "idle" and (not isinstance(session_id, str) or not session_id):
        raise CliError(
            "SoloPi 返回的%s sessionId 无效" % label,
            4,
            response=response,
        )
    error = response.get("error")
    if error is not None and not isinstance(error, str):
        raise CliError("SoloPi 返回的%s错误无效" % label, 4, response=response)


def validate_performance_display_status(response: Dict[str, Any]) -> None:
    validate_owned_session_status(
        response,
        "performance display",
        PERFORMANCE_DISPLAY_STATES,
        PERFORMANCE_DISPLAY_ACTIVE_STATES,
        PERFORMANCE_DISPLAY_TERMINAL_STATES,
    )
    if not response.get("success"):
        if not isinstance(response.get("error"), str) or not response["error"]:
            raise CliError(
                "SoloPi 返回的性能浮窗错误无效",
                4,
                response=response,
            )
        nested = response.get("performanceDisplay")
        if nested is not None:
            if not isinstance(nested, dict):
                raise CliError(
                    "SoloPi 返回的性能浮窗错误状态无效",
                    4,
                    response=response,
                )
            validate_performance_display_status(nested)
        return

    state = response["state"]
    running = response.get("running")
    stop_retryable = response.get("stopRetryable")
    sampled_at = response.get("sampledAt")
    values = response.get("values")
    list_fields = ("items", "ownedDisplayNames", "runningItems")
    if (
        response.get("kind") != "performance-display"
        or not isinstance(running, bool)
        or running is not (state == "running")
        or not isinstance(stop_retryable, bool)
        or (stop_retryable and state != "stopping")
        or isinstance(sampled_at, bool)
        or not isinstance(sampled_at, int)
        or sampled_at <= 0
        or not isinstance(values, dict)
        or any(not isinstance(key, str) or not key for key in values)
        or any(
            not isinstance(response.get(field), list)
            or any(not isinstance(item, str) or not item for item in response[field])
            or len(response[field]) != len(set(response[field]))
            for field in list_fields
        )
    ):
        raise CliError(
            "SoloPi 返回的性能浮窗状态无效",
            4,
            response=response,
        )

    target_package = response.get("targetPackage")
    if target_package is not None and (
        not isinstance(target_package, str)
        or (
            target_package != "-"
            and ANDROID_PACKAGE_PATTERN.fullmatch(target_package) is None
        )
    ):
        raise CliError(
            "SoloPi 返回的性能浮窗目标包名无效",
            4,
            response=response,
        )
    if not set(values).issubset(set(response["ownedDisplayNames"])):
        raise CliError(
            "SoloPi 返回了不属于当前性能浮窗会话的指标值",
            4,
            response=response,
        )

    session_id = response.get("sessionId")
    started_at = response.get("startedAt")
    finished_at = response.get("finishedAt")
    duration_ms = response.get("durationMs")
    if state == "idle":
        if any(
            response.get(field) is not None
            for field in ("sessionId", "targetPackage", "startedAt", "finishedAt", "durationMs", "error")
        ) or response["items"] or response["ownedDisplayNames"] or values:
            raise CliError(
                "SoloPi 返回的空闲性能浮窗状态不一致",
                4,
                response=response,
            )
        return
    if (
        not isinstance(session_id, str)
        or PERFORMANCE_DISPLAY_SESSION_ID_PATTERN.fullmatch(session_id) is None
    ):
        raise CliError(
            "SoloPi 返回的性能浮窗 sessionId 无效",
            4,
            response=response,
        )
    for field, value in (("startedAt", started_at), ("finishedAt", finished_at), ("durationMs", duration_ms)):
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < (0 if field == "durationMs" else 1)
        ):
            raise CliError(
                "SoloPi 返回的性能浮窗字段 %s 无效" % field,
                4,
                response=response,
            )
    if state == "running" and (started_at is None or finished_at is not None):
        raise CliError(
            "SoloPi 返回的运行中性能浮窗时间戳不一致",
            4,
            response=response,
        )
    if state == "starting" and (started_at is not None or duration_ms is not None):
        raise CliError(
            "SoloPi 提前返回了性能浮窗启动数据",
            4,
            response=response,
        )
    if started_at is None and duration_ms is not None:
        raise CliError(
            "SoloPi 返回了性能浮窗时长但缺少开始时间",
            4,
            response=response,
        )
    if state == "stopped" and started_at is None:
        raise CliError(
            "SoloPi 返回的已停止性能浮窗缺少开始时间",
            4,
            response=response,
        )
    if started_at is not None and finished_at is not None:
        if finished_at < started_at or duration_ms != finished_at - started_at:
            raise CliError(
                "SoloPi 返回的性能浮窗时长不一致",
                4,
                response=response,
            )
    if state in PERFORMANCE_DISPLAY_TERMINAL_STATES and finished_at is None:
        raise CliError(
            "SoloPi 返回的性能浮窗处于未完成终态",
            4,
            response=response,
        )
    if state not in PERFORMANCE_DISPLAY_TERMINAL_STATES and finished_at is not None:
        raise CliError(
            "SoloPi 提前返回了性能浮窗完成时间",
            4,
            response=response,
        )
    error = response.get("error")
    if state == "failed" and (not isinstance(error, str) or not error):
        raise CliError(
            "SoloPi 返回性能浮窗失败但缺少错误",
            4,
            response=response,
        )
    if state in {"idle", "starting", "running", "stopped"} and error is not None:
        raise CliError(
            "SoloPi 返回了意外的性能浮窗错误",
            4,
            response=response,
        )


def validate_record_status(response: Dict[str, Any]) -> None:
    validate_owned_session_status(
        response,
        "recording",
        RECORD_STATES,
        RECORD_ACTIVE_STATES,
        RECORD_TERMINAL_STATES,
    )
    if not response.get("success"):
        if (
            not isinstance(response.get("errorCode"), str)
            or not response["errorCode"]
            or not isinstance(response.get("error"), str)
            or not response["error"]
        ):
            raise CliError("SoloPi 返回的录制错误无效", 4, response=response)
        nested = response.get("recording")
        if nested is not None:
            if not isinstance(nested, dict):
                raise CliError("SoloPi 返回的录制错误状态无效", 4, response=response)
            validate_record_status(nested)
        return

    state = response["state"]
    cancelled = response.get("cancelledBeforeStart")
    started_at = response.get("startedAt")
    finished_at = response.get("finishedAt")
    duration_ms = response.get("durationMs")
    case_id = response.get("caseId")
    if (
        response.get("kind") != "recording"
        or not isinstance(response.get("recording"), bool)
        or response["recording"] is not (state == "recording")
        or not isinstance(cancelled, bool)
        or not (
            response.get("caseName") is None
            or isinstance(response.get("caseName"), str)
        )
        or not (
            response.get("targetPackage") is None
            or isinstance(response.get("targetPackage"), str)
        )
    ):
        raise CliError("SoloPi 返回的录制状态无效", 4, response=response)

    if state == "idle":
        if any(
            response.get(field) is not None
            for field in (
                "sessionId",
                "caseName",
                "caseId",
                "targetPackage",
                "startedAt",
                "finishedAt",
                "durationMs",
                "error",
            )
        ) or cancelled:
            raise CliError("SoloPi 返回的空闲录制状态不一致", 4, response=response)
        return

    if (
        not response.get("caseName")
        or not response.get("targetPackage")
        or (started_at is not None and (
            isinstance(started_at, bool) or not isinstance(started_at, int) or started_at <= 0
        ))
        or (finished_at is not None and (
            isinstance(finished_at, bool) or not isinstance(finished_at, int) or finished_at <= 0
        ))
        or (duration_ms is not None and (
            isinstance(duration_ms, bool) or not isinstance(duration_ms, int) or duration_ms < 0
        ))
    ):
        raise CliError("SoloPi 返回的录制元数据无效", 4, response=response)
    if (started_at is None) is not (duration_ms is None):
        raise CliError("SoloPi 返回的录制时长不一致", 4, response=response)
    if finished_at is not None and started_at is not None and (
        finished_at < started_at or duration_ms != finished_at - started_at
    ):
        raise CliError("SoloPi 返回的录制时间戳不一致", 4, response=response)
    if state in RECORD_TERMINAL_STATES:
        if finished_at is None:
            raise CliError("SoloPi 返回的录制处于未完成终态", 4, response=response)
    elif finished_at is not None:
        raise CliError("SoloPi 提前返回了录制完成时间", 4, response=response)

    error = response.get("error")
    if state == "failed":
        if not isinstance(error, str) or not error:
            raise CliError("SoloPi 返回录制失败但缺少错误", 4, response=response)
    elif error is not None:
        raise CliError("SoloPi 返回了意外的录制错误", 4, response=response)

    if cancelled:
        if state != "stopped" or started_at is not None or case_id is not None:
            raise CliError("SoloPi 返回的已取消录制无效", 4, response=response)
    elif state == "stopped":
        if (
            isinstance(case_id, bool)
            or not isinstance(case_id, int)
            or case_id <= 0
            or started_at is None
        ):
            raise CliError("SoloPi 返回的已停止录制缺少 caseId", 4, response=response)
    elif case_id is not None:
        raise CliError("SoloPi 提前返回了录制 caseId", 4, response=response)

    if state in {"recording", "stopping"} and started_at is None:
        raise CliError("SoloPi 返回的活动录制缺少 startedAt", 4, response=response)


def validate_screen_record_captures_root(raw_path: Any) -> str:
    if (
        not isinstance(raw_path, str)
        or not raw_path
        or len(raw_path) > 1024
        or raw_path.startswith("//")
        or "\\" in raw_path
        or any(ord(character) < 32 or ord(character) == 127 for character in raw_path)
    ):
        raise CliError("SoloPi 返回了不安全的屏幕采集根目录", 4)
    root = PurePosixPath(raw_path)
    if (
        not root.is_absolute()
        or str(root) != raw_path
        or root.name != "ScreenCaptures"
        or len(root.parts) < 4
        or any(part in {"", ".", ".."} for part in root.parts[1:])
    ):
        raise CliError("SoloPi 返回了不安全的屏幕采集根目录", 4)
    return raw_path


def validate_screen_record_output_path(raw_path: Any, captures_root: Any) -> str:
    root_value = validate_screen_record_captures_root(captures_root)
    if (
        not isinstance(raw_path, str)
        or not raw_path
        or len(raw_path) > 1200
        or raw_path.startswith("//")
        or "\\" in raw_path
        or any(ord(character) < 32 or ord(character) == 127 for character in raw_path)
    ):
        raise CliError("SoloPi 返回了不安全的录屏输出路径", 4)
    output = PurePosixPath(raw_path)
    root = PurePosixPath(root_value)
    if (
        not output.is_absolute()
        or str(output) != raw_path
        or output.parent != root
        or SCREEN_RECORD_FILE_PATTERN.fullmatch(output.name) is None
    ):
        raise CliError(
            "SoloPi 返回的录屏文件位于采集根目录之外",
            4,
            outputPath=raw_path,
            capturesRoot=root_value,
        )
    return raw_path


def validate_screen_record_status(response: Dict[str, Any]) -> None:
    if not isinstance(response, dict) or not isinstance(response.get("success"), bool):
        raise CliError("SoloPi 返回的录屏响应无效", 4, response=response)
    if not response["success"]:
        if (
            not isinstance(response.get("errorCode"), str)
            or not response["errorCode"]
            or not isinstance(response.get("error"), str)
            or not response["error"]
        ):
            raise CliError("SoloPi 返回的录屏错误无效", 4, response=response)
        nested = response.get("screenRecording")
        if nested is not None:
            if not isinstance(nested, dict):
                raise CliError("SoloPi 返回的录屏错误状态无效", 4, response=response)
            validate_screen_record_status(nested)
        return

    state = response.get("state")
    active = response.get("active")
    terminal = response.get("terminal")
    recording = response.get("recording")
    user_action_required = response.get("userActionRequired")
    cancelled = response.get("cancelledBeforeStart")
    auto_stopped = response.get("autoStopped")
    if (
        response.get("kind") != "screen-recording"
        or state not in SCREEN_RECORD_STATES
        or not isinstance(active, bool)
        or active is not (state in SCREEN_RECORD_ACTIVE_STATES)
        or not isinstance(terminal, bool)
        or terminal is not (state in SCREEN_RECORD_TERMINAL_STATES)
        or not isinstance(recording, bool)
        or recording is not (state == "recording")
        or not isinstance(user_action_required, bool)
        or user_action_required is not (state == "pending-user-confirmation")
        or not isinstance(cancelled, bool)
        or not isinstance(auto_stopped, bool)
    ):
        raise CliError("SoloPi 返回的录屏状态标记不一致", 4, response=response)
    if user_action_required:
        if response.get("requiredUserAction") != SCREEN_RECORD_REQUIRED_USER_ACTION:
            raise CliError("SoloPi 返回的必要用户操作无效", 4, response=response)
    elif response.get("requiredUserAction") is not None:
        raise CliError("SoloPi 返回了意外的必要用户操作", 4, response=response)

    session_id = response.get("sessionId")
    if state == "idle":
        nullable_fields = (
            "sessionId",
            "resolution",
            "width",
            "height",
            "bitrateKbps",
            "frameRate",
            "durationSec",
            "requestedAt",
            "startedAt",
            "finishedAt",
            "durationMs",
            "capturesRoot",
            "outputPath",
            "fileSize",
            "error",
        )
        if any(response.get(field) is not None for field in nullable_fields) or cancelled or auto_stopped:
            raise CliError("SoloPi 返回的空闲录屏状态不一致", 4, response=response)
        return
    if (
        not isinstance(session_id, str)
        or SCREEN_RECORD_SESSION_ID_PATTERN.fullmatch(session_id) is None
    ):
        raise CliError("SoloPi 返回的录屏 sessionId 无效", 4, response=response)

    resolution = response.get("resolution")
    match = (
        SCREEN_RECORD_RESOLUTION_PATTERN.fullmatch(resolution)
        if isinstance(resolution, str)
        else None
    )
    width = response.get("width")
    height = response.get("height")
    bitrate = response.get("bitrateKbps")
    frame_rate = response.get("frameRate")
    duration_sec = response.get("durationSec")
    requested_at = response.get("requestedAt")
    if (
        match is None
        or isinstance(width, bool)
        or not isinstance(width, int)
        or not 128 <= width <= 4096
        or width % 2 != 0
        or isinstance(height, bool)
        or not isinstance(height, int)
        or not 128 <= height <= 4096
        or height % 2 != 0
        or int(match.group(1)) != width
        or int(match.group(2)) != height
        or isinstance(bitrate, bool)
        or not isinstance(bitrate, int)
        or not 100 <= bitrate <= 50000
        or isinstance(frame_rate, bool)
        or not isinstance(frame_rate, int)
        or not 1 <= frame_rate <= 120
        or isinstance(duration_sec, bool)
        or not isinstance(duration_sec, int)
        or not 1 <= duration_sec <= 3600
        or isinstance(requested_at, bool)
        or not isinstance(requested_at, int)
        or requested_at <= 0
    ):
        raise CliError("SoloPi 返回的录屏配置无效", 4, response=response)

    captures_root = validate_screen_record_captures_root(response.get("capturesRoot"))
    output_path = response.get("outputPath")
    file_size = response.get("fileSize")
    if output_path is None:
        if file_size is not None:
            raise CliError("SoloPi 返回了录屏文件大小但缺少输出路径", 4, response=response)
    else:
        validate_screen_record_output_path(output_path, captures_root)
        if file_size is not None and (
            isinstance(file_size, bool) or not isinstance(file_size, int) or file_size < 0
        ):
            raise CliError("SoloPi 返回的录屏文件大小无效", 4, response=response)

    started_at = response.get("startedAt")
    finished_at = response.get("finishedAt")
    duration_ms = response.get("durationMs")
    for field_name, value in (("startedAt", started_at), ("finishedAt", finished_at)):
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, int) or value <= 0
        ):
            raise CliError("SoloPi 返回的字段 %s 无效" % field_name, 4, response=response)
    if duration_ms is not None and (
        isinstance(duration_ms, bool) or not isinstance(duration_ms, int) or duration_ms < 0
    ):
        raise CliError("SoloPi 返回的录屏时长无效", 4, response=response)
    if (started_at is None) is not (duration_ms is None):
        raise CliError("SoloPi 返回的录屏时长不一致", 4, response=response)
    if started_at is not None and started_at < requested_at:
        raise CliError("SoloPi 返回的录屏开始时间不一致", 4, response=response)
    if finished_at is not None and (
        finished_at < requested_at
        or (started_at is not None and (
            finished_at < started_at or duration_ms != finished_at - started_at
        ))
    ):
        raise CliError("SoloPi 返回的录屏完成时间不一致", 4, response=response)
    if state in SCREEN_RECORD_TERMINAL_STATES:
        if finished_at is None:
            raise CliError("SoloPi 返回的录屏处于未完成终态", 4, response=response)
    elif finished_at is not None:
        raise CliError("SoloPi 提前返回了录屏完成时间", 4, response=response)

    error = response.get("error")
    if state == "failed":
        if not isinstance(error, str) or not error:
            raise CliError("SoloPi 返回录屏失败但缺少错误", 4, response=response)
    elif error is not None:
        raise CliError("SoloPi 返回了意外的录屏错误", 4, response=response)

    if cancelled:
        if (
            state != "stopped"
            or started_at is not None
            or output_path is not None
            or file_size is not None
        ):
            raise CliError("SoloPi 返回的已取消录屏无效", 4, response=response)
    elif state == "stopped" and (
        started_at is None
        or output_path is None
        or isinstance(file_size, bool)
        or not isinstance(file_size, int)
        or file_size <= 0
    ):
        raise CliError("SoloPi 返回的已停止录屏信息不完整", 4, response=response)

    if state == "pending-user-confirmation" and output_path is not None:
        raise CliError("SoloPi 在录屏确认前返回了输出路径", 4, response=response)
    if state == "recording" and (started_at is None or output_path is None):
        raise CliError("SoloPi 返回的活动录屏信息不完整", 4, response=response)
    if auto_stopped and state not in {"stopping", "stopped", "failed"}:
        raise CliError("SoloPi 返回的自动停止标记无效", 4, response=response)


def validate_scan_status(response: Dict[str, Any]) -> None:
    if not isinstance(response, dict) or not isinstance(response.get("success"), bool):
        raise CliError("SoloPi 返回的扫码响应无效", 4, response=response)
    if not response["success"]:
        if (
            not isinstance(response.get("errorCode"), str)
            or not response["errorCode"]
            or not isinstance(response.get("error"), str)
            or not response["error"]
        ):
            raise CliError("SoloPi 返回的扫码错误无效", 4, response=response)
        nested = response.get("scan")
        if nested is not None:
            if not isinstance(nested, dict):
                raise CliError("SoloPi 返回的嵌套扫码状态无效", 4, response=response)
            validate_scan_status(nested)
        return

    state = response.get("state")
    active = response.get("active")
    terminal = response.get("terminal")
    scanning = response.get("scanning")
    user_action_required = response.get("userActionRequired")
    manual_scan_active = response.get("manualScanActive")
    protocol_activity_attached = response.get("protocolActivityAttached")
    required_user_action = response.get("requiredUserAction")
    expected_user_action = SCAN_REQUIRED_USER_ACTIONS.get(state)
    if (
        response.get("kind") != "scan"
        or state not in SCAN_STATES
        or not isinstance(active, bool)
        or active is not (state in SCAN_ACTIVE_STATES)
        or not isinstance(terminal, bool)
        or terminal is not (state in SCAN_TERMINAL_STATES)
        or not isinstance(scanning, bool)
        or scanning is not (state == "scanning")
        or not isinstance(user_action_required, bool)
        or user_action_required is not (expected_user_action is not None)
        or required_user_action != expected_user_action
        or not isinstance(manual_scan_active, bool)
        or not isinstance(protocol_activity_attached, bool)
        or response.get("contentExecuted") is not False
        or (active and manual_scan_active)
        or (manual_scan_active and protocol_activity_attached)
    ):
        raise CliError("SoloPi 返回的扫码状态标记不一致", 4, response=response)

    nullable_fields = (
        "sessionId",
        "content",
        "format",
        "codeType",
        "requestedAt",
        "startedAt",
        "finishedAt",
        "durationMs",
        "error",
    )
    if state == "idle":
        if any(response.get(field) is not None for field in nullable_fields):
            raise CliError("SoloPi 返回的空闲扫码状态不一致", 4, response=response)
        return

    session_id = response.get("sessionId")
    requested_at = response.get("requestedAt")
    if (
        not isinstance(session_id, str)
        or SCAN_SESSION_ID_PATTERN.fullmatch(session_id) is None
        or isinstance(requested_at, bool)
        or not isinstance(requested_at, int)
        or requested_at <= 0
    ):
        raise CliError("SoloPi 返回的扫码会话所有权无效", 4, response=response)

    started_at = response.get("startedAt")
    finished_at = response.get("finishedAt")
    duration_ms = response.get("durationMs")
    for field_name, value in (("startedAt", started_at), ("finishedAt", finished_at)):
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, int) or value <= 0
        ):
            raise CliError("SoloPi 返回的扫码字段 %s 无效" % field_name, 4, response=response)
    if duration_ms is not None and (
        isinstance(duration_ms, bool) or not isinstance(duration_ms, int) or duration_ms < 0
    ):
        raise CliError("SoloPi 返回的扫码时长无效", 4, response=response)
    if started_at is not None and started_at < requested_at:
        raise CliError("SoloPi 返回的扫码开始时间不一致", 4, response=response)
    if (started_at is not None and finished_at is not None) is not (duration_ms is not None):
        raise CliError("SoloPi 返回的扫码时长不一致", 4, response=response)
    if finished_at is not None and (
        finished_at < requested_at
        or (started_at is not None and (
            finished_at < started_at or duration_ms != finished_at - started_at
        ))
    ):
        raise CliError("SoloPi 返回的扫码完成时间不一致", 4, response=response)
    if state in SCAN_TERMINAL_STATES:
        if finished_at is None:
            raise CliError("SoloPi 返回的扫码处于未完成终态", 4, response=response)
    elif finished_at is not None:
        raise CliError("SoloPi 提前返回了扫码完成时间", 4, response=response)
    if state in {"scanning", "completed"} and started_at is None:
        raise CliError("SoloPi 返回的扫码缺少相机开始时间", 4, response=response)
    if state in {"starting", "pending-camera-permission"} and started_at is not None:
        raise CliError("SoloPi 提前返回了扫码开始时间", 4, response=response)

    content = response.get("content")
    scan_format = response.get("format")
    code_type = response.get("codeType")
    if state == "completed":
        if (
            not isinstance(content, str)
            or not content
            or not isinstance(scan_format, str)
            or SCAN_FORMAT_CODE_TYPES.get(scan_format) != code_type
        ):
            raise CliError("SoloPi 返回的已完成扫码无效", 4, response=response)
    elif any(value is not None for value in (content, scan_format, code_type)):
        raise CliError("SoloPi 在扫码完成前返回了内容", 4, response=response)

    error = response.get("error")
    if state == "failed":
        if not isinstance(error, str) or not error:
            raise CliError("SoloPi 返回扫码失败但缺少错误", 4, response=response)
    elif error is not None:
        raise CliError("SoloPi 返回了意外的扫码错误", 4, response=response)


def video_analysis_request_id(raw_value: Any) -> str:
    if (
        not isinstance(raw_value, str)
        or VIDEO_ANALYSIS_REQUEST_ID_PATTERN.fullmatch(raw_value) is None
    ):
        raise CliError("视频分析 requestId 格式无效", 3, requestId=raw_value)
    return raw_value


def validate_video_analysis_device_path(raw_path: Any, exit_code: int = 3) -> str:
    if (
        not isinstance(raw_path, str)
        or not raw_path
        or raw_path != raw_path.strip()
        or len(raw_path) > 1200
        or raw_path.startswith("//")
        or "\\" in raw_path
        or any(ord(character) < 32 or ord(character) == 127 for character in raw_path)
    ):
        raise CliError("视频路径必须是设备上的安全绝对路径", exit_code, videoPath=raw_path)
    video = PurePosixPath(raw_path)
    root = video.parent
    parts = root.parts
    sdcard_root = len(parts) >= 4 and parts[1] == "sdcard"
    emulated_root = (
        len(parts) >= 6
        and parts[1:3] == ("storage", "emulated")
        and parts[3].isdigit()
    )
    if (
        not video.is_absolute()
        or str(video) != raw_path
        or any(part in {"", ".", ".."} for part in video.parts[1:])
        or root.name != "ScreenCaptures"
        or not (sdcard_root or emulated_root)
        or SCREEN_RECORD_FILE_PATTERN.fullmatch(video.name) is None
    ):
        raise CliError(
            "视频路径必须是设备 ScreenCaptures 目录的直属 MP4 文件",
            exit_code,
            videoPath=raw_path,
        )
    return raw_path


def validate_video_analysis_response(
    response: Dict[str, Any], expected_request_id: str
) -> None:
    if not isinstance(response, dict) or not isinstance(response.get("success"), bool):
        raise CliError("SoloPi 返回无效的视频分析响应", 4, response=response)
    state = response.get("state")
    if state is None:
        if response["success"]:
            raise CliError("SoloPi 返回缺少状态的视频分析响应", 4, response=response)
        error_code = response.get("errorCode")
        error = response.get("error")
        if (
            error_code not in VIDEO_ANALYSIS_ERROR_CODES
            or not isinstance(error, str)
            or not error
        ):
            raise CliError("SoloPi 返回无效的视频分析错误", 4, response=response)
        response_request_id = response.get("requestId")
        if response_request_id is not None and response_request_id != expected_request_id:
            raise CliError(
                "SoloPi 视频分析错误不匹配 requestId",
                4,
                expectedRequestId=expected_request_id,
                response=response,
            )
        return

    if state not in VIDEO_ANALYSIS_STATES:
        raise CliError("SoloPi 返回未知的视频分析状态", 4, response=response)
    if response.get("requestId") != expected_request_id:
        raise CliError(
            "SoloPi 视频分析状态不匹配 requestId",
            4,
            expectedRequestId=expected_request_id,
            response=response,
        )
    terminal = response.get("terminal")
    if not isinstance(terminal, bool) or terminal is not (state in VIDEO_ANALYSIS_TERMINAL_STATES):
        raise CliError("SoloPi 返回不一致的视频分析终态标记", 4, response=response)
    if response["success"] is not (state != "failed"):
        raise CliError("SoloPi 返回不一致的视频分析成功标记", 4, response=response)

    video_path = validate_video_analysis_device_path(response.get("videoPath"), exit_code=4)
    video_file_name = response.get("videoFileName")
    size_bytes = response.get("sizeBytes")
    action_offset = response.get("actionOffsetMs")
    threshold = response.get("differenceThreshold")
    started_at = response.get("startedAt")
    if (
        not isinstance(video_file_name, str)
        or video_file_name != PurePosixPath(video_path).name
        or isinstance(size_bytes, bool)
        or not isinstance(size_bytes, int)
        or size_bytes <= 0
        or isinstance(action_offset, bool)
        or not isinstance(action_offset, int)
        or not 0 <= action_offset <= VIDEO_ANALYSIS_MAX_ACTION_OFFSET_MS
        or isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not math.isfinite(float(threshold))
        or not 0 < float(threshold) <= 1
        or isinstance(started_at, bool)
        or not isinstance(started_at, int)
        or started_at <= 0
    ):
        raise CliError("SoloPi 返回无效的视频分析元数据", 4, response=response)

    completed_at = response.get("completedAt")
    if terminal:
        if (
            isinstance(completed_at, bool)
            or not isinstance(completed_at, int)
            or completed_at < started_at
        ):
            raise CliError("SoloPi 返回无效的视频分析完成时间", 4, response=response)
    elif completed_at is not None:
        raise CliError("SoloPi 提前返回视频分析完成时间", 4, response=response)

    response_time = response.get("visualResponseTimeMs")
    measurement = response.get("measurement")
    error_code = response.get("errorCode")
    error = response.get("error")
    if state == "completed":
        if (
            isinstance(response_time, bool)
            or not isinstance(response_time, int)
            or response_time < 0
            or measurement != VIDEO_ANALYSIS_MEASUREMENT
            or error_code is not None
            or error is not None
        ):
            raise CliError("SoloPi 返回无效的视频分析成功结果", 4, response=response)
    elif state == "failed":
        if (
            error_code != "analysis_failed"
            or not isinstance(error, str)
            or not error
            or response_time is not None
            or measurement is not None
        ):
            raise CliError("SoloPi 返回无效的视频分析失败结果", 4, response=response)
    elif any(value is not None for value in (response_time, measurement, error_code, error)):
        raise CliError("SoloPi 在分析中状态提前返回终态字段", 4, response=response)


def wait_for_video_analysis(
    session: HarnessSession,
    request_id: str,
    timeout: float,
    poll_interval: float,
    *,
    require_terminal: bool,
) -> Dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_response: Optional[Dict[str, Any]] = None
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        request_timeout = min(
            float(getattr(session, "request_timeout", remaining)), remaining
        )
        last_response = session.video_analysis(request_id, timeout=request_timeout)
        validate_video_analysis_response(last_response, request_id)
        state = last_response.get("state")
        if state is not None:
            if not require_terminal or state in VIDEO_ANALYSIS_TERMINAL_STATES:
                return last_response
        elif last_response.get("errorCode") != "analysis_not_found":
            return last_response
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(poll_interval, remaining))
    raise CliError(
        "等待视频分析状态超时",
        124,
        requestId=request_id,
        phase="video-analysis-terminal" if require_terminal else "video-analysis-ack",
        lastResponse=last_response,
    )


def validate_stress_status(response: Dict[str, Any]) -> None:
    validate_owned_session_status(
        response,
        "stress",
        STRESS_STATES,
        STRESS_ACTIVE_STATES,
        STRESS_TERMINAL_STATES,
    )
    if not response.get("success"):
        return
    limits = {
        "cpuCount": (0, None),
        "cpuPercent": (0, STRESS_MAX_CPU_PERCENT),
        "memory": (0, STRESS_MAX_MEMORY_MB),
        "durationSec": (0, STRESS_MAX_DURATION_SECONDS),
    }
    for field, (minimum, maximum) in limits.items():
        if field not in response:
            if field == "durationSec":
                continue
            raise CliError("SoloPi 返回的压力状态不完整", 4, response=response)
        value = response[field]
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < minimum
            or (maximum is not None and value > maximum)
        ):
            raise CliError("SoloPi 返回的压力限制值无效", 4, response=response)


def wait_for_owned_session_state(
    query_status: Callable[[Optional[float]], Dict[str, Any]],
    validator: Callable[[Dict[str, Any]], None],
    request_timeout: float,
    session_id: str,
    target_states: Iterable[str],
    timeout: float,
    poll_interval: float,
    operation: str,
    label: str,
    ignored_session_id: Optional[str] = None,
    allow_ignored_session: bool = False,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    on_status: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    require_positive_finite(timeout, "%s timeout" % label.capitalize())
    require_positive_finite(poll_interval, "%s poll interval" % label.capitalize())
    expected_states = set(target_states)
    deadline = clock() + timeout
    last_status: Optional[Dict[str, Any]] = None
    seen_expected_session = False
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            break
        last_status = query_status(min(remaining, request_timeout))
        validator(last_status)
        if not last_status["success"]:
            raise CliError(
                "无法查询 SoloPi %s 状态" % label,
                2,
                response=last_status,
            )
        current_session_id = last_status.get("sessionId")
        if current_session_id == session_id:
            seen_expected_session = True
            if last_status.get("state") in expected_states:
                return last_status
            if on_status is not None:
                on_status(last_status)
        elif (
            seen_expected_session
            or not allow_ignored_session
            or current_session_id != ignored_session_id
        ):
            raise CliError(
                "%s session was replaced by another session" % label.capitalize(),
                2,
                expectedSessionId=session_id,
                latestStatus=last_status,
            )
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(poll_interval, remaining))
    raise CliError(
        "%s %s timed out" % (label.capitalize(), operation),
        124,
        sessionId=session_id,
        lastStatus=last_status,
    )


def wait_for_performance_display_state(
    session: HarnessSession,
    session_id: str,
    target_states: Iterable[str],
    timeout: float,
    poll_interval: float,
    operation: str,
    ignored_session_id: Optional[str] = None,
    allow_ignored_session: bool = False,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    on_status: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    request_timeout = float(getattr(session, "request_timeout", timeout))
    return wait_for_owned_session_state(
        session.performance_display,
        validate_performance_display_status,
        request_timeout,
        session_id,
        target_states,
        timeout,
        poll_interval,
        operation,
        "performance display",
        ignored_session_id=ignored_session_id,
        allow_ignored_session=allow_ignored_session,
        clock=clock,
        sleep=sleep,
        on_status=on_status,
    )


def scan_session_id(raw_value: str) -> str:
    value = require_non_blank(raw_value, "扫码 sessionId")
    if SCAN_SESSION_ID_PATTERN.fullmatch(value) is None:
        raise CliError("扫码 sessionId 无效", 3, sessionId=value)
    return value


def wait_for_scan_state(
    session: HarnessSession,
    session_id: str,
    target_states: Iterable[str],
    timeout: float,
    poll_interval: float,
    operation: str,
    ignored_session_id: Optional[str] = None,
    allow_ignored_session: bool = False,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Dict[str, Any]:
    request_timeout = float(getattr(session, "request_timeout", timeout))
    return wait_for_owned_session_state(
        session.scan,
        validate_scan_status,
        request_timeout,
        session_id,
        target_states,
        timeout,
        poll_interval,
        operation,
        "scan",
        ignored_session_id=ignored_session_id,
        allow_ignored_session=allow_ignored_session,
        clock=clock,
        sleep=sleep,
    )


def screen_record_session_id(raw_value: str) -> str:
    value = require_non_blank(raw_value, "录屏 sessionId")
    if SCREEN_RECORD_SESSION_ID_PATTERN.fullmatch(value) is None:
        raise CliError("录屏 sessionId 无效", 3, sessionId=value)
    return value


def validate_screen_record_config(args: argparse.Namespace) -> Dict[str, str]:
    resolution = args.resolution
    match = (
        SCREEN_RECORD_RESOLUTION_PATTERN.fullmatch(resolution)
        if isinstance(resolution, str)
        else None
    )
    if match is None:
        raise CliError("录屏分辨率必须使用 WIDTHxHEIGHT 格式", 3)
    width = int(match.group(1))
    height = int(match.group(2))
    if (
        not 128 <= width <= 4096
        or not 128 <= height <= 4096
        or width % 2 != 0
        or height % 2 != 0
    ):
        raise CliError(
            "录屏宽高必须是 128 到 4096 之间的偶数",
            3,
        )
    integer_bounds = {
        "bitrateKbps": (args.bitrate_kbps, 100, 50000),
        "frameRate": (args.frame_rate, 1, 120),
        "durationSec": (args.duration, 1, 3600),
    }
    for field, (value, minimum, maximum) in integer_bounds.items():
        if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
            raise CliError(
                "录屏参数 %s 超出支持范围" % field,
                3,
                field=field,
                value=value,
            )
    return {
        "resolution": resolution,
        "bitrateKbps": str(args.bitrate_kbps),
        "frameRate": str(args.frame_rate),
        "durationSec": str(args.duration),
    }


def wait_for_screen_record_state(
    session: HarnessSession,
    session_id: str,
    target_states: Iterable[str],
    timeout: float,
    poll_interval: float,
    operation: str,
    ignored_session_id: Optional[str] = None,
    allow_ignored_session: bool = False,
    expected_captures_root: Optional[str] = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Dict[str, Any]:
    require_positive_finite(timeout, "录屏操作超时")
    require_positive_finite(poll_interval, "录屏状态轮询间隔")
    expected_states = set(target_states)
    deadline = clock() + timeout
    last_status: Optional[Dict[str, Any]] = None
    seen_expected_session = False
    captures_root = expected_captures_root
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            break
        request_timeout = min(remaining, getattr(session, "request_timeout", remaining))
        last_status = session.screen_record("status", timeout=request_timeout)
        validate_screen_record_status(last_status)
        if not last_status["success"]:
            raise CliError(
                "无法查询 SoloPi 录屏状态",
                2,
                response=last_status,
            )
        current_session_id = last_status.get("sessionId")
        if current_session_id == session_id:
            seen_expected_session = True
            current_root = last_status.get("capturesRoot")
            if captures_root is None:
                captures_root = current_root
            elif current_root != captures_root:
                raise CliError(
                    "录屏会话期间采集根目录发生变化",
                    4,
                    expectedCapturesRoot=captures_root,
                    latestStatus=last_status,
                )
            if last_status.get("state") in expected_states:
                return last_status
        elif (
            seen_expected_session
            or not allow_ignored_session
            or current_session_id != ignored_session_id
        ):
            raise CliError(
                "录屏会话已被其他会话替换",
                2,
                expectedSessionId=session_id,
                latestStatus=last_status,
            )
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(poll_interval, remaining))

    pending_confirmation = bool(
        last_status
        and last_status.get("sessionId") == session_id
        and last_status.get("state") == "pending-user-confirmation"
    )
    message = "录屏操作 %s 超时" % operation
    if pending_confirmation:
        message += "; confirm the Android MediaProjection system dialog on the device"
    raise CliError(
        message,
        124,
        sessionId=session_id,
        lastStatus=last_status,
        userActionRequired=pending_confirmation,
        requiredUserAction=(
            SCREEN_RECORD_REQUIRED_USER_ACTION if pending_confirmation else None
        ),
    )


def validate_config_response(response: Dict[str, Any], expected_key: Optional[str] = None) -> None:
    if not isinstance(response.get("success"), bool):
        raise CliError("SoloPi 返回的配置响应无效", 4, response=response)
    if not response["success"]:
        return
    if expected_key is not None:
        config = response.get("config")
        if not isinstance(config, dict) or config.get("key") != expected_key:
            raise CliError("SoloPi 返回的配置值无效", 4, response=response)
        sensitive = config.get("sensitive") is True or expected_key in {
            "KEY_AES_KEY",
            "KEY_GLOBAL_SETTINGS",
        }
        if sensitive:
            if (
                config.get("sensitive") is not True
                or config.get("redacted") is not True
                or config.get("value") is not None
            ):
                raise CliError(
                    "SoloPi 返回的敏感配置值无效",
                    4,
                    response=response,
                )
        elif "value" not in config:
            raise CliError("SoloPi 返回的配置值无效", 4, response=response)


def canonical_config_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (str, int, float)):
        return str(value)
    raise CliError("SoloPi 返回了不支持的配置值", 4, value=value)


def config_value_matches(config: Dict[str, Any], expected_value: str) -> bool:
    actual_value = config.get("value")
    value_type = config.get("type")
    if value_type == "boolean":
        return isinstance(actual_value, bool) and expected_value.lower() in {"true", "false"} and (
            actual_value is (expected_value.lower() == "true")
        )
    if value_type in {"int", "long"}:
        try:
            parsed_expected = int(expected_value)
        except ValueError:
            return False
        return not isinstance(actual_value, bool) and actual_value == parsed_expected
    if value_type == "json":
        try:
            expected_json = json.loads(expected_value)
            actual_json = json.loads(actual_value) if isinstance(actual_value, str) else actual_value
        except (json.JSONDecodeError, TypeError):
            return False
        return actual_json == expected_json
    return canonical_config_value(actual_value) == expected_value


def validate_config_input(config: Dict[str, Any], value: str) -> None:
    value_type = config.get("type")
    key = config.get("key")
    if value_type == "boolean":
        if value.lower() not in {"true", "false"}:
            raise CliError("布尔配置必须是 true 或 false", 3, key=key)
        return
    if value_type in {"int", "long"}:
        try:
            parsed = int(value)
        except ValueError as exc:
            raise CliError("数值配置必须是整数", 3, key=key) from exc
        minimum = config.get("min")
        maximum = config.get("max")
        if (
            isinstance(minimum, (int, float)) and parsed < minimum
        ) or (
            isinstance(maximum, (int, float)) and parsed > maximum
        ):
            raise CliError(
                "配置值超出支持范围",
                3,
                key=key,
                min=minimum,
                max=maximum,
            )
        return
    if value_type == "json":
        try:
            parsed_json = json.loads(value)
        except json.JSONDecodeError as exc:
            raise CliError("JSON 配置必须是对象", 3, key=key) from exc
        if not isinstance(parsed_json, dict):
            raise CliError("JSON 配置必须是对象", 3, key=key)
        return
    if value_type == "string":
        if len(value) > 4096 or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise CliError("字符串配置过长或包含控制字符", 3, key=key)
        if key == "KEY_OUTPUT_CHARSET":
            try:
                codecs.lookup(value)
            except LookupError as exc:
                raise CliError("不支持该输出字符集", 3, key=key) from exc
        return
    raise CliError("SoloPi 返回了不支持的配置类型", 4, config=config)


def wait_for_config_value(
    session: HarnessSession,
    key: str,
    expected_value: str,
    timeout: float,
    poll_interval: float,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Dict[str, Any]:
    require_positive_finite(timeout, "配置确认超时")
    require_positive_finite(poll_interval, "配置状态轮询间隔")
    deadline = clock() + timeout
    last_response: Optional[Dict[str, Any]] = None
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            break
        last_response = session.config(
            "get",
            key,
            timeout=min(remaining, session.request_timeout),
        )
        validate_config_response(last_response, key)
        if last_response["success"] and config_value_matches(
            last_response["config"], expected_value
        ):
            return last_response
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(poll_interval, remaining))
    raise CliError(
        "SoloPi 配置更新超时",
        124,
        key=key,
        expectedValue=expected_value,
        lastConfig=last_response,
    )


def validate_history_envelope(response: Dict[str, Any]) -> None:
    if not isinstance(response.get("success"), bool):
        raise CliError("SoloPi 返回的历史记录响应无效", 4, response=response)
    if not response["success"]:
        if (
            not isinstance(response.get("errorCode"), str)
            or not response["errorCode"]
            or not isinstance(response.get("error"), str)
            or not response["error"]
        ):
            raise CliError("SoloPi 返回的历史记录错误无效", 4, response=response)


def history_record_id(raw_id: str, kind: str) -> str:
    record_id = require_non_blank(raw_id, "历史记录 ID")
    pattern = HISTORY_ID_PATTERNS[kind]
    if pattern.fullmatch(record_id) is None:
        raise CliError(
            "历史记录 ID 无效",
            3,
            kind=kind,
            id=record_id,
        )
    return record_id


def validate_history_list(response: Dict[str, Any], kind: str, limit: int) -> None:
    validate_history_envelope(response)
    if not response["success"]:
        return
    records = response.get("records")
    total = response.get("total")
    returned = response.get("returned")
    truncated = response.get("truncated")
    if (
        response.get("kind") != kind
        or not isinstance(records, list)
        or isinstance(total, bool)
        or not isinstance(total, int)
        or total < 0
        or isinstance(returned, bool)
        or not isinstance(returned, int)
        or returned < 0
        or returned != len(records)
        or returned > total
        or returned > limit
        or not isinstance(truncated, bool)
        or truncated is not (returned < total)
    ):
        raise CliError("SoloPi 返回的历史记录列表无效", 4, response=response)
    for record in records:
        if (
            not isinstance(record, dict)
            or record.get("kind") != kind
            or not isinstance(record.get("id"), str)
            or HISTORY_ID_PATTERNS[kind].fullmatch(record["id"]) is None
        ):
            raise CliError("SoloPi 返回的历史记录无效", 4, response=response)


def validate_history_detail(response: Dict[str, Any], kind: str, record_id: str) -> None:
    validate_history_envelope(response)
    if not response["success"]:
        return
    if response.get("kind") != kind or response.get("id") != record_id:
        raise CliError("SoloPi 返回了不匹配的历史记录详情", 4, response=response)


def validate_history_mutation_status(
    response: Dict[str, Any],
    request_id: str,
    kind: str,
    action: str,
    record_id: str,
) -> None:
    validate_history_envelope(response)
    if not response["success"]:
        return
    mutation = response.get("mutation")
    state = response.get("state")
    if (
        response.get("requestId") != request_id
        or state not in {"in_progress", "completed", "failed"}
        or not isinstance(mutation, dict)
        or mutation.get("requestId") != request_id
        or mutation.get("kind") != kind
        or mutation.get("action") != action
        or mutation.get("id") != record_id
        or mutation.get("state") != state
        or not isinstance(mutation.get("success"), bool)
    ):
        raise CliError("SoloPi 返回的历史记录变更回执无效", 4, response=response)
    if state == "completed" and (
        mutation["success"] is not True or mutation.get("deleted") is not True
    ):
        raise CliError("SoloPi 返回的已完成变更状态不一致", 4, response=response)
    if state == "failed" and (
        mutation["success"] is not False
        or mutation.get("deleted") is not False
        or not isinstance(mutation.get("errorCode"), str)
        or not isinstance(mutation.get("error"), str)
    ):
        raise CliError("SoloPi 返回的失败变更状态不一致", 4, response=response)


def wait_for_history_mutation(
    session: HarnessSession,
    request_id: str,
    kind: str,
    action: str,
    record_id: str,
    timeout: float,
    poll_interval: float,
) -> Dict[str, Any]:
    require_positive_finite(timeout, "历史记录删除超时")
    require_positive_finite(poll_interval, "历史记录状态轮询间隔")
    deadline = time.monotonic() + timeout
    last_response: Optional[Dict[str, Any]] = None
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        last_response = session.history(
            "mutationStatus",
            {"requestId": request_id},
            timeout=min(remaining, session.request_timeout),
        )
        validate_history_mutation_status(last_response, request_id, kind, action, record_id)
        if not last_response["success"]:
            if last_response.get("errorCode") == "receipt_not_found":
                time.sleep(min(poll_interval, max(0.0, deadline - time.monotonic())))
                continue
            return last_response
        if last_response.get("state") in {"completed", "failed"}:
            return last_response
        time.sleep(min(poll_interval, max(0.0, deadline - time.monotonic())))
    raise CliError(
        "SoloPi 历史记录删除超时",
        124,
        requestId=request_id,
        kind=kind,
        id=record_id,
        lastResponse=last_response,
    )


def validate_plugin_envelope(response: Dict[str, Any]) -> None:
    if not isinstance(response, dict) or not isinstance(response.get("success"), bool):
        raise CliError("SoloPi 返回的插件响应无效", 4, response=response)
    if not response["success"] and (
        not isinstance(response.get("errorCode"), str)
        or not response["errorCode"]
        or not isinstance(response.get("error"), str)
        or not response["error"]
    ):
        raise CliError("SoloPi 返回的插件错误无效", 4, response=response)


def validate_plugin_import_path(raw_path: Any) -> str:
    if (
        not isinstance(raw_path, str)
        or not raw_path
        or len(raw_path) > 1024
        or raw_path.startswith("//")
        or "\\" in raw_path
        or any(ord(character) < 32 or ord(character) == 127 for character in raw_path)
    ):
        raise CliError("SoloPi 返回了不安全的插件导入路径", 4)
    path = PurePosixPath(raw_path)
    if (
        not path.is_absolute()
        or str(path) != raw_path
        or path.name != "patch"
        or len(path.parts) < 4
        or any(part in {"", ".", ".."} for part in path.parts[1:])
    ):
        raise CliError("SoloPi 返回了不安全的插件导入路径", 4)
    return raw_path


def validate_generated_plugin_file_name(raw_name: Any) -> str:
    if (
        not isinstance(raw_name, str)
        or PLUGIN_GENERATED_FILE_PATTERN.fullmatch(raw_name) is None
    ):
        raise CliError("生成的插件导入文件名无效", 4)
    return raw_name


def generated_plugin_file_name(request_id: str) -> str:
    digest = hashlib.sha256(request_id.encode("utf-8")).hexdigest()
    return "solopi-plugin-%s.zip" % digest[:32]


def plugin_id(raw_id: str) -> str:
    normalized = require_non_blank(raw_id, "插件 ID")
    if PLUGIN_ID_PATTERN.fullmatch(normalized) is None:
        raise CliError("插件 ID 无效", 3, pluginId=normalized)
    return normalized


def snapshot_plugin_archive(source_value: str, destination: Path) -> tuple[int, str]:
    source = Path(source_value)
    if source.suffix.lower() != ".zip":
        raise CliError("插件包必须是 .zip 文件", 3, file=str(source))
    if source.is_symlink():
        raise CliError("插件包必须是普通文件，不能是符号链接", 3)

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(str(source), flags)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise CliError("未找到插件包文件", 3, file=str(source)) from exc
    except OSError as exc:
        raise CliError("无法打开插件包", 3, file=str(source)) from exc

    digest = hashlib.sha256()
    total = 0
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            raise CliError("插件包必须是普通文件", 3)
        if metadata.st_size <= 0 or metadata.st_size > PLUGIN_MAX_ARCHIVE_BYTES:
            raise CliError(
                "插件包大小必须在 1 字节到 64 MiB 之间",
                3,
                sizeBytes=metadata.st_size,
            )
        with os.fdopen(descriptor, "rb") as source_stream:
            descriptor = -1
            with destination.open("wb") as target_stream:
                while True:
                    chunk = source_stream.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > PLUGIN_MAX_ARCHIVE_BYTES:
                        raise CliError("插件包超过 64 MiB 限制", 3)
                    digest.update(chunk)
                    target_stream.write(chunk)
    finally:
        if descriptor >= 0:
            os.close(descriptor)

    if total <= 0:
        raise CliError("插件包不能为空", 3)
    try:
        with zipfile.ZipFile(destination, "r") as archive:
            if not archive.infolist():
                raise CliError("插件 ZIP 包至少需要包含一个条目", 3)
    except (OSError, zipfile.BadZipFile) as exc:
        raise CliError("插件包不是有效的 ZIP 压缩包", 3) from exc
    return total, digest.hexdigest()


def _is_plugin_number(value: Any, positive: bool = False) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    number = float(value)
    return math.isfinite(number) and (not positive or number > 0)


def validate_plugin_summary(plugin: Any) -> None:
    if not isinstance(plugin, dict):
        raise CliError("SoloPi 返回的插件描述无效", 4)
    status = plugin.get("status")
    source = plugin.get("source")
    core = plugin.get("core")
    removable = plugin.get("removable")
    runtime_loaded = plugin.get("runtimeLoaded")
    if (
        not isinstance(plugin.get("id"), str)
        or PLUGIN_ID_PATTERN.fullmatch(plugin["id"]) is None
        or not isinstance(plugin.get("name"), str)
        or not plugin["name"]
        or len(plugin["name"]) > 64
        or not _is_plugin_number(plugin.get("version"), positive=True)
        or status not in {"built_in", "installed", "loaded"}
        or source not in {"built_in", "managed_patch_store", "runtime_registry"}
        or not isinstance(core, bool)
        or not isinstance(removable, bool)
        or not isinstance(runtime_loaded, bool)
        or any(
            not isinstance(plugin.get(key), bool)
            for key in ("hasCode", "hasNativeLibraries", "hasAssets")
        )
        or not (
            plugin.get("filter") is None or isinstance(plugin.get("filter"), str)
        )
        or not isinstance(plugin.get("dependencies"), list)
        or any(
            not isinstance(dependency, str) or not dependency
            for dependency in plugin["dependencies"]
        )
        or not isinstance(plugin.get("catalogAvailable"), bool)
    ):
        raise CliError("SoloPi 返回的插件描述无效", 4, plugin=plugin)
    if core:
        if status != "built_in" or source != "built_in" or removable:
            raise CliError("SoloPi 返回的内置插件状态不一致", 4, plugin=plugin)
    elif (
        status == "built_in"
        or source == "built_in"
        or removable is not True
        or runtime_loaded is not (status == "loaded")
    ):
        raise CliError("SoloPi 返回的已安装插件状态不一致", 4, plugin=plugin)

    has_catalog_version = "catalogVersion" in plugin
    has_update_available = "updateAvailable" in plugin
    if has_catalog_version != has_update_available or (
        has_catalog_version
        and (
            not _is_plugin_number(plugin["catalogVersion"], positive=True)
            or not isinstance(plugin["updateAvailable"], bool)
            or plugin.get("catalogAvailable") is not True
        )
    ):
        raise CliError("SoloPi 返回的插件目录描述无效", 4, plugin=plugin)


def validate_plugin_list(response: Dict[str, Any]) -> Optional[str]:
    validate_plugin_envelope(response)
    if not response["success"]:
        return None
    plugins = response.get("plugins")
    import_files = response.get("importFiles")
    total = response.get("total")
    if (
        not isinstance(plugins, list)
        or isinstance(total, bool)
        or not isinstance(total, int)
        or total != len(plugins)
        or response.get("importDirectory") != "patch"
        or response.get("pathAvailable") is not True
        or not isinstance(import_files, list)
        or not isinstance(response.get("importFilesTruncated"), bool)
        or response.get("mutationTransport") != "adb"
    ):
        raise CliError("SoloPi 返回的插件列表无效", 4, response=response)

    import_path = validate_plugin_import_path(response.get("importPath"))
    plugin_ids = set()
    for plugin in plugins:
        validate_plugin_summary(plugin)
        if plugin["id"] in plugin_ids:
            raise CliError("SoloPi 返回了重复的插件 ID", 4, response=response)
        plugin_ids.add(plugin["id"])

    file_ids = set()
    file_names = set()
    for candidate in import_files:
        if (
            not isinstance(candidate, dict)
            or not isinstance(candidate.get("fileId"), str)
            or PLUGIN_IMPORT_ID_PATTERN.fullmatch(candidate["fileId"]) is None
            or not isinstance(candidate.get("fileName"), str)
            or PLUGIN_IMPORT_FILE_PATTERN.fullmatch(candidate["fileName"]) is None
            or isinstance(candidate.get("sizeBytes"), bool)
            or not isinstance(candidate.get("sizeBytes"), int)
            or not 0 < candidate["sizeBytes"] <= PLUGIN_MAX_ARCHIVE_BYTES
            or isinstance(candidate.get("modifiedAt"), bool)
            or not isinstance(candidate.get("modifiedAt"), int)
            or candidate["modifiedAt"] < 0
            or candidate.get("sha256Required") is not True
            or candidate["fileId"] in file_ids
            or candidate["fileName"] in file_names
        ):
            raise CliError("SoloPi 返回的插件导入文件无效", 4, response=response)
        file_ids.add(candidate["fileId"])
        file_names.add(candidate["fileName"])
    return import_path


def validate_plugin_mutation_status(
    response: Dict[str, Any],
    request_id: str,
    action: str,
    subject: str,
    expected_sha256: Optional[str] = None,
    expected_file_id: Optional[str] = None,
    expected_size: Optional[int] = None,
    expected_plugin_id: Optional[str] = None,
) -> None:
    validate_plugin_envelope(response)
    if not response["success"]:
        return
    state = response.get("state")
    mutation = response.get("mutation")
    if (
        response.get("requestId") != request_id
        or state not in PLUGIN_MUTATION_STATES
        or not isinstance(mutation, dict)
        or mutation.get("requestId") != request_id
        or mutation.get("action") != action
        or mutation.get("subject") != subject
        or mutation.get("state") != state
        or not isinstance(mutation.get("success"), bool)
        or mutation.get("accepted") is not True
        or isinstance(mutation.get("requestedAt"), bool)
        or not isinstance(mutation.get("requestedAt"), int)
        or mutation["requestedAt"] < 0
    ):
        raise CliError("SoloPi 返回的插件变更回执无效", 4, response=response)

    if state == "in_progress":
        if mutation["success"] is not True or "completedAt" in mutation:
            raise CliError("SoloPi 返回的插件变更状态不一致", 4, response=response)
        return

    if (
        isinstance(mutation.get("completedAt"), bool)
        or not isinstance(mutation.get("completedAt"), int)
        or mutation["completedAt"] < mutation["requestedAt"]
    ):
        raise CliError("SoloPi 返回的插件完成时间无效", 4, response=response)
    if state == "failed":
        if (
            mutation["success"] is not False
            or not isinstance(mutation.get("errorCode"), str)
            or not mutation["errorCode"]
            or not isinstance(mutation.get("error"), str)
            or not mutation["error"]
        ):
            raise CliError("SoloPi 返回的失败插件变更状态不一致", 4, response=response)
        return

    if mutation["success"] is not True or mutation.get("restartRequired") is not True:
        raise CliError("SoloPi 返回的已完成插件变更状态不一致", 4, response=response)
    if action == "import":
        if (
            expected_sha256 is None
            or expected_file_id is None
            or expected_size is None
            or mutation.get("sha256") != expected_sha256
            or mutation.get("sourceFileId") != expected_file_id
            or mutation.get("sizeBytes") != expected_size
            or mutation.get("sourceFileRetained") is not True
            or mutation.get("activation") != "restart_required_for_full_activation"
        ):
            raise CliError("SoloPi 返回了不匹配的插件导入回执", 4, response=response)
        validate_plugin_summary(mutation.get("plugin"))
    elif action == "remove":
        if (
            expected_plugin_id is None
            or mutation.get("pluginId") != expected_plugin_id
            or not isinstance(mutation.get("name"), str)
            or not mutation["name"]
            or not _is_plugin_number(mutation.get("version"), positive=True)
            or mutation.get("removedFromRegistry") is not True
            or mutation.get("filesRetained") is not True
            or mutation.get("runtimeEffect") != "restart_required_for_full_removal"
        ):
            raise CliError("SoloPi 返回了不匹配的插件移除回执", 4, response=response)
    else:
        raise CliError("不支持该插件变更动作", 4, action=action)


def wait_for_plugin_mutation(
    session: HarnessSession,
    request_id: str,
    action: str,
    subject: str,
    timeout: float,
    poll_interval: float,
    expected_sha256: Optional[str] = None,
    expected_file_id: Optional[str] = None,
    expected_size: Optional[int] = None,
    expected_plugin_id: Optional[str] = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Dict[str, Any]:
    require_positive_finite(timeout, "插件变更超时")
    require_positive_finite(poll_interval, "插件状态轮询间隔")
    deadline = clock() + timeout
    last_response: Optional[Dict[str, Any]] = None
    while clock() < deadline:
        remaining = deadline - clock()
        request_timeout = min(remaining, getattr(session, "request_timeout", remaining))
        last_response = session.plugin(
            "mutationStatus",
            {"requestId": request_id},
            timeout=request_timeout,
        )
        validate_plugin_mutation_status(
            last_response,
            request_id,
            action,
            subject,
            expected_sha256=expected_sha256,
            expected_file_id=expected_file_id,
            expected_size=expected_size,
            expected_plugin_id=expected_plugin_id,
        )
        if not last_response["success"]:
            if last_response.get("errorCode") == "receipt_not_found":
                sleep(min(poll_interval, max(0.0, deadline - clock())))
                continue
            return last_response
        if last_response.get("state") in PLUGIN_TERMINAL_STATES:
            return last_response
        sleep(min(poll_interval, max(0.0, deadline - clock())))
    raise CliError(
        "SoloPi 插件变更超时",
        124,
        requestId=request_id,
        action=action,
        lastResponse=last_response,
    )


def pull_performance_output(
    adb: AdbClient,
    remote_path: str,
    records_root: str,
    output: Path,
) -> str:
    if not isinstance(remote_path, str) or not isinstance(records_root, str):
        raise CliError(
            "SoloPi 返回的性能输出位置无效",
            4,
            outputPath=remote_path,
            recordsRoot=records_root,
        )
    device_path = PurePosixPath(remote_path)
    root_path = PurePosixPath(records_root)
    if (
        any(ord(character) < 32 or ord(character) == 127 for character in remote_path)
        or any(ord(character) < 32 or ord(character) == 127 for character in records_root)
        or not device_path.is_absolute()
        or not root_path.is_absolute()
        or ".." in device_path.parts
        or ".." in root_path.parts
        or not (
            remote_path.startswith("/sdcard/")
            or remote_path.startswith("/storage/emulated/")
        )
        or not (
            records_root.startswith("/sdcard/")
            or records_root.startswith("/storage/emulated/")
        )
        or root_path.name != "records"
    ):
        raise CliError(
            "SoloPi 返回了不安全的性能输出路径",
            4,
            outputPath=remote_path,
            recordsRoot=records_root,
        )
    try:
        relative_output = device_path.relative_to(root_path)
    except ValueError as exc:
        raise CliError(
            "SoloPi 返回的性能路径位于记录根目录之外",
            4,
            outputPath=remote_path,
            recordsRoot=records_root,
        ) from exc
    if len(relative_output.parts) != 1 or not re.fullmatch(
        r"performance-[A-Za-z0-9][A-Za-z0-9._-]{0,115}",
        relative_output.name,
    ):
        raise CliError(
            "SoloPi 返回的性能记录目录无效",
            4,
            outputPath=remote_path,
            recordsRoot=records_root,
        )
    if output.exists():
        raise CliError(
            "性能输出路径已存在",
            3,
            output=str(output),
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    adb.pull(remote_path, output)
    if not output.is_dir() or not any(output.rglob("*.csv")):
        raise CliError(
            "ADB 报告成功，但未拉取到性能 CSV 文件",
            4,
            remotePath=remote_path,
            output=str(output),
        )
    return str(output.resolve())


def pull_screen_record_output(
    adb: AdbClient,
    remote_path: Any,
    captures_root: Any,
    reported_size: Any,
    output: Path,
) -> str:
    validated_remote = validate_screen_record_output_path(remote_path, captures_root)
    if (
        isinstance(reported_size, bool)
        or not isinstance(reported_size, int)
        or reported_size <= 0
    ):
        raise CliError(
            "SoloPi 未报告非空录屏文件",
            4,
            outputPath=validated_remote,
            fileSize=reported_size,
        )
    if output.exists() or output.is_symlink():
        raise CliError("录屏输出路径已存在", 3, output=str(output))

    device_size = adb._screen_recording_file_size(validated_remote, captures_root)
    if device_size != reported_size:
        raise CliError(
            "设备端录屏文件大小与终态不一致",
            4,
            outputPath=validated_remote,
            reportedSize=reported_size,
            deviceSize=device_size,
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".solopi-screen-record-",
        dir=str(output.parent),
    ) as temporary_dir:
        staged_output = Path(temporary_dir) / "capture.mp4"
        adb.pull(validated_remote, staged_output)
        if (
            not staged_output.is_file()
            or staged_output.is_symlink()
            or staged_output.stat().st_size != device_size
        ):
            raise CliError(
                "ADB 未完整拉取录屏文件",
                4,
                outputPath=validated_remote,
                expectedSize=device_size,
            )
        try:
            os.link(staged_output, output)
        except FileExistsError as exc:
            raise CliError(
                "录屏输出路径已存在",
                3,
                output=str(output),
            ) from exc
        except OSError as exc:
            raise CliError(
                "无法发布已拉取的录屏文件",
                4,
                output=str(output),
            ) from exc
    if not output.is_file() or output.stat().st_size != device_size:
        raise CliError(
            "录屏输出校验失败",
            4,
            output=str(output),
        )
    return str(output.resolve())


def wait_for_import_receipt(
    session: HarnessSession,
    request_id: str,
    timeout: float,
    poll_interval: float,
) -> Dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_response: Optional[Dict[str, Any]] = None
    while time.monotonic() < deadline:
        last_response = session.query("case-import-status", {"requestId": request_id})
        if (
            last_response.get("requestId") == request_id
            and last_response.get("errorCode") != "import_receipt_not_found"
        ):
            return last_response
        time.sleep(poll_interval)
    raise CliError(
        "SoloPi 未发布用例导入回执",
        124,
        requestId=request_id,
        lastResponse=last_response,
    )


def wait_for_case_delete_receipt(
    session: HarnessSession,
    request_id: str,
    timeout: float,
    poll_interval: float,
) -> Dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_response: Optional[Dict[str, Any]] = None
    while time.monotonic() < deadline:
        last_response = session.query("case-delete-status", {"requestId": request_id})
        error_code = last_response.get("errorCode")
        receipt_missing = isinstance(error_code, str) and "receipt_not_found" in error_code
        if last_response.get("requestId") == request_id and not receipt_missing:
            return last_response
        time.sleep(poll_interval)
    raise CliError(
        "SoloPi 未发布用例删除回执",
        124,
        requestId=request_id,
        lastResponse=last_response,
    )


def collect_artifacts(adb: AdbClient, status: Dict[str, Any], output_dir: Path) -> Dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    result_path = output_dir / "result.json"
    screenshot_path = output_dir / "screen.png"
    logcat_path = output_dir / "logcat.txt"

    result_path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    screenshot_path.write_bytes(adb.screenshot())
    logcat_path.write_text(adb.logcat(), encoding="utf-8")
    return {
        "result": str(result_path.resolve()),
        "screenshot": str(screenshot_path.resolve()),
        "logcat": str(logcat_path.resolve()),
    }


def load_json_file(source: Path) -> Any:
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except OSError as exc:
        raise CliError("无法读取用例文件", 3, file=str(source), reason=str(exc)) from exc
    except json.JSONDecodeError as exc:
        raise CliError(
            "用例文件不是有效 JSON",
            3,
            file=str(source),
            line=exc.lineno,
            column=exc.colno,
        ) from exc


def write_json_file(target: Path, payload: Any) -> str:
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError as exc:
        raise CliError("无法写入 JSON 文件", 3, file=str(target), reason=str(exc)) from exc
    return str(target.resolve())


def expand_case_for_authoring(case_payload: Dict[str, Any]) -> Dict[str, Any]:
    expanded = copy.deepcopy(case_payload)
    operation_log = expanded.get("operationLog")
    if isinstance(operation_log, str):
        try:
            operation_log = json.loads(operation_log)
        except json.JSONDecodeError as exc:
            raise CliError("SoloPi 用例包含无效的 operationLog", 4) from exc
    if not isinstance(operation_log, dict):
        raise CliError("SoloPi 用例的 operationLog 必须是对象或编码后的对象", 4)
    operation_log.pop("storePath", None)
    expanded["operationLog"] = operation_log
    return expanded


def normalize_action_enum(value: Any, step_index: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CliError("用例步骤必须包含 actionEnum", 3, stepIndex=step_index)
    candidate = value.strip()
    if candidate in PROVIDER_ACTION_BY_CODE:
        return str(PROVIDER_ACTION_BY_CODE[candidate]["actionEnum"])
    if candidate in ACTION_ENUMS:
        normalized = candidate
    elif candidate in ACTION_CODE_TO_ENUM:
        normalized = ACTION_CODE_TO_ENUM[candidate]
    else:
        upper_candidate = candidate.upper()
        if upper_candidate in ACTION_ENUMS:
            normalized = upper_candidate
        else:
            raise CliError(
                "不支持该 SoloPi actionEnum",
                3,
                stepIndex=step_index,
                actionEnum=value,
            )
    if normalized in RUNTIME_ONLY_ACTION_ENUMS:
        raise CliError(
            "SoloPi 运行时专用动作不能编写为用例步骤",
            3,
            stepIndex=step_index,
            actionEnum=value,
        )
    return normalized


def validate_provider_action_params(
    target_action: str,
    action_enum: str,
    params: Dict[str, Optional[str]],
    step_index: int,
) -> None:
    descriptor = PROVIDER_ACTION_BY_CODE.get(target_action)
    if descriptor is None:
        return
    expected_enum = descriptor["actionEnum"]
    if action_enum != expected_enum:
        raise CliError(
            "动态 Provider 动作使用了错误的外层 actionEnum",
            3,
            stepIndex=step_index,
            targetAction=target_action,
            expectedActionEnum=expected_enum,
        )
    missing_params = sorted(
        key
        for key in PROVIDER_ACTION_REQUIRED_PARAMS[target_action]
        if not isinstance(params.get(key), str) or not params[key].strip()
    )
    if missing_params:
        raise CliError(
            "动态 Provider 动作缺少必要参数",
            3,
            stepIndex=step_index,
            targetAction=target_action,
            missingParams=missing_params,
        )
    if target_action in {"clickByScreenshot", "assertScreenshot"}:
        origin_size = params.get("originSize")
        if origin_size is not None and re.fullmatch(
            r"([1-9][0-9]*),([1-9][0-9]*)", str(origin_size)
        ) is None:
            raise CliError(
                "截图 Provider 的 originSize 必须使用 WIDTH,HEIGHT 格式",
                3,
                stepIndex=step_index,
                targetAction=target_action,
            )
    elif target_action == "startRecord":
        items = [item.strip() for item in str(params["checkList"]).split(",")]
        if not items or any(not item for item in items):
            raise CliError(
                "性能 Provider 的 checkList 必须包含逗号分隔的指标键",
                3,
                stepIndex=step_index,
                targetAction=target_action,
            )
    elif target_action == "startRecordScreen":
        resolution = str(params["resolution"])
        if re.fullmatch(r"[1-9][0-9]*x[1-9][0-9]*", resolution) is None:
            raise CliError(
                "录屏分辨率必须使用 WIDTHxHEIGHT 格式",
                3,
                stepIndex=step_index,
                targetAction=target_action,
            )
        for key in ("INTENT_VIDEO_BITRATE", "INTENT_FRAME_RATE"):
            try:
                value = int(str(params[key]))
            except ValueError as exc:
                raise CliError(
                    "录屏数值参数必须是整数",
                    3,
                    stepIndex=step_index,
                    targetAction=target_action,
                    param=key,
                ) from exc
            if value <= 0:
                raise CliError(
                    "录屏数值参数必须大于零",
                    3,
                    stepIndex=step_index,
                    targetAction=target_action,
                    param=key,
                )
        try:
            expected_diff = float(str(params["INTENT_EXCEPT_DIFF"]))
        except ValueError as exc:
            raise CliError(
                "录屏 INTENT_EXCEPT_DIFF 必须是数字",
                3,
                stepIndex=step_index,
                targetAction=target_action,
            ) from exc
        if not math.isfinite(expected_diff) or expected_diff <= 0:
            raise CliError(
                "录屏 INTENT_EXCEPT_DIFF 必须是大于零的有限数字",
                3,
                stepIndex=step_index,
                targetAction=target_action,
            )


def validate_running_param(running_param: Any) -> Dict[str, Any]:
    if not isinstance(running_param, dict):
        raise CliError("用例 runningParam 必须是对象", 3)

    expected_fields = {"mode", "paramList"}
    missing_fields = sorted(expected_fields - set(running_param))
    unknown_fields = sorted(
        (field for field in running_param if field not in expected_fields),
        key=str,
    )
    if missing_fields or unknown_fields:
        raise CliError(
            "用例 runningParam 只能包含 mode 和 paramList",
            3,
            missingFields=missing_fields,
            unknownFields=unknown_fields,
        )

    mode = running_param["mode"]
    if not isinstance(mode, str) or mode not in {"SEPARATE", "UNION"}:
        raise CliError(
            "用例 runningParam.mode 必须是 SEPARATE 或 UNION",
            3,
            mode=mode,
        )
    param_list = running_param["paramList"]
    if not isinstance(param_list, list) or not param_list:
        raise CliError("用例 runningParam.paramList 必须是非空数组", 3)

    separate_keys = set()
    union_keys: Optional[set[str]] = None
    for index, item in enumerate(param_list):
        if not isinstance(item, dict) or not item:
            raise CliError(
                "用例 runningParam 条目必须是非空对象",
                3,
                paramIndex=index,
            )
        if mode == "SEPARATE" and len(item) != 1:
            raise CliError(
                "SEPARATE 模式的 runningParam 条目必须只包含一个参数",
                3,
                paramIndex=index,
            )

        item_keys = set()
        for key, value in item.items():
            if not isinstance(key, str) or not key.strip():
                raise CliError(
                    "用例 runningParam 的键必须是非空字符串",
                    3,
                    paramIndex=index,
                )
            if key != key.strip():
                raise CliError(
                    "用例 runningParam 的键前后不能有空白字符",
                    3,
                    paramIndex=index,
                    param=key,
                )
            if not isinstance(value, str) or not value.strip():
                raise CliError(
                    "用例 runningParam 的值必须是非空字符串",
                    3,
                    paramIndex=index,
                    param=key,
                )
            if mode == "SEPARATE" and any(
                not part.strip() for part in value.split(",")
            ):
                raise CliError(
                    "SEPARATE 模式的 runningParam 值必须由逗号分隔，且各项非空",
                    3,
                    paramIndex=index,
                    param=key,
                )
            item_keys.add(key)

        if mode == "SEPARATE":
            key = next(iter(item_keys))
            if key in separate_keys:
                raise CliError(
                    "SEPARATE 模式的 runningParam 键必须唯一",
                    3,
                    paramIndex=index,
                    param=key,
                )
            separate_keys.add(key)
        elif union_keys is None:
            union_keys = item_keys
        elif item_keys != union_keys:
            raise CliError(
                "UNION 模式的 runningParam 各行必须包含相同参数键",
                3,
                paramIndex=index,
                expectedKeys=sorted(union_keys),
                actualKeys=sorted(item_keys),
            )

    return copy.deepcopy(running_param)


def parse_advance_settings(value: Any) -> Dict[str, Any]:
    if not isinstance(value, str):
        raise CliError("用例字段必须是字符串", 3, field="advanceSettings")
    if not value.strip():
        return {}
    try:
        settings = json.loads(value)
    except json.JSONDecodeError as exc:
        raise CliError("用例 advanceSettings 不是有效的编码 JSON", 3) from exc
    if not isinstance(settings, dict):
        raise CliError("用例 advanceSettings 必须是编码后的对象", 3)
    if "runningParam" in settings:
        settings["runningParam"] = validate_running_param(settings["runningParam"])
    return settings


def encode_advance_settings(settings: Dict[str, Any]) -> str:
    return json.dumps(settings, ensure_ascii=False, separators=(",", ":"))


def normalize_case(case_payload: Any) -> Dict[str, Any]:
    if not isinstance(case_payload, dict):
        raise CliError("用例 JSON 必须是对象", 3)
    normalized = copy.deepcopy(case_payload)

    for field in ("caseName", "targetAppPackage"):
        value = normalized.get(field)
        if not isinstance(value, str) or not value.strip():
            raise CliError("缺少必要用例字段", 3, field=field)
        normalized[field] = value.strip()

    normalized.setdefault("caseDesc", "")
    normalized.setdefault("targetAppLabel", normalized["targetAppPackage"])
    normalized.setdefault("recordMode", "local")
    normalized.setdefault("advanceSettings", "")
    normalized.setdefault("priority", 2)
    for field in ("caseDesc", "targetAppLabel", "recordMode"):
        if not isinstance(normalized[field], str):
            raise CliError("用例字段必须是字符串", 3, field=field)
    advance_settings = parse_advance_settings(normalized["advanceSettings"])
    if normalized["advanceSettings"].strip():
        normalized["advanceSettings"] = encode_advance_settings(advance_settings)
    else:
        normalized["advanceSettings"] = ""
    if isinstance(normalized["priority"], bool) or not isinstance(normalized["priority"], int):
        raise CliError("用例 priority 必须是整数", 3, field="priority")
    if normalized["priority"] < 0 or normalized["priority"] > 2:
        raise CliError("用例 priority 必须在 0 到 2 之间", 3, field="priority")

    operation_log = normalized.get("operationLog")
    if isinstance(operation_log, str):
        try:
            operation_log = json.loads(operation_log)
        except json.JSONDecodeError as exc:
            raise CliError("用例 operationLog 不是有效的编码 JSON", 3) from exc
    if not isinstance(operation_log, dict):
        raise CliError("用例 operationLog 必须是对象或编码后的对象", 3)
    steps = operation_log.get("steps")
    if not isinstance(steps, list) or not steps:
        raise CliError("用例 operationLog.steps 必须是非空数组", 3)

    operation_id = "ai-%s" % normalized["caseName"]
    normalized_steps: List[Dict[str, Any]] = []
    step_ids = set()
    active_provider_starts = set()
    for index, raw_step in enumerate(steps):
        if not isinstance(raw_step, dict):
            raise CliError("用例步骤必须是对象", 3, stepIndex=index)
        step = copy.deepcopy(raw_step)
        method = step.get("operationMethod")
        if not isinstance(method, dict):
            raise CliError("用例步骤的 operationMethod 必须是对象", 3, stepIndex=index)
        raw_action_enum = method.get("actionEnum")
        action_enum = normalize_action_enum(raw_action_enum, index)
        method["actionEnum"] = action_enum
        params = method.get("operationParam", {})
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise CliError("operationParam 必须是对象", 3, stepIndex=index)
        normalized_params: Dict[str, Optional[str]] = {}
        for key, value in params.items():
            if not isinstance(key, str):
                raise CliError("operationParam 的键必须是字符串", 3, stepIndex=index)
            if value is None or isinstance(value, str):
                normalized_params[key] = value
            elif isinstance(value, (int, float, bool)):
                normalized_params[key] = str(value).lower() if isinstance(value, bool) else str(value)
            else:
                raise CliError(
                    "operationParam values must be scalar strings",
                    3,
                    stepIndex=index,
                    param=key,
                )
        if isinstance(raw_action_enum, str) and raw_action_enum.strip() in PROVIDER_ACTION_BY_CODE:
            normalized_params.setdefault("targetAction", raw_action_enum.strip())
        method["operationParam"] = normalized_params
        missing_params = sorted(
            key for key in REQUIRED_ACTION_PARAMS.get(action_enum, set())
            if key not in normalized_params
        )
        if missing_params:
            raise CliError(
                "用例动作缺少必要参数",
                3,
                stepIndex=index,
                actionEnum=action_enum,
                missingParams=missing_params,
            )
        target_action = normalized_params.get("targetAction")
        if isinstance(target_action, str):
            validate_provider_action_params(target_action, action_enum, normalized_params, index)
            prior_action = PROVIDER_ACTION_PRIOR_ACTION.get(target_action)
            if prior_action is not None:
                if prior_action not in active_provider_starts:
                    raise CliError(
                        "动态 Provider 停止动作需要此前存在匹配的启动动作",
                        3,
                        stepIndex=index,
                        targetAction=target_action,
                        requiresPriorAction=prior_action,
                    )
                active_provider_starts.remove(prior_action)
            elif target_action in PROVIDER_ACTION_PRIOR_ACTION.values():
                if target_action in active_provider_starts:
                    raise CliError(
                        "当前用例中对应的动态 Provider 启动动作仍处于活动状态",
                        3,
                        stepIndex=index,
                        targetAction=target_action,
                    )
                active_provider_starts.add(target_action)
        method.setdefault("encrypt", False)
        method.setdefault("safeEncrypt", False)
        if not isinstance(method["encrypt"], bool) or not isinstance(method["safeEncrypt"], bool):
            raise CliError("操作加密标记必须是布尔值", 3, stepIndex=index)
        step["operationMethod"] = method

        node = step.get("operationNode")
        if action_enum in NODE_ACTION_ENUMS:
            if not isinstance(node, dict):
                raise CliError("节点动作必须包含 operationNode", 3, stepIndex=index)
            if not any(isinstance(node.get(field), str) and node[field].strip()
                       for field in NODE_SELECTOR_FIELDS):
                raise CliError(
                    "节点动作需要使用从 inspect 或 case-get 复制的 selector",
                    3,
                    stepIndex=index,
                )
        elif node is not None and not isinstance(node, dict):
            raise CliError("operationNode 必须是对象或 null", 3, stepIndex=index)

        operation_index = step.get("operationIndex", index)
        if isinstance(operation_index, bool) or not isinstance(operation_index, int) or operation_index < 0:
            raise CliError("operationIndex 必须是非负整数", 3, stepIndex=index)
        step["operationIndex"] = operation_index
        step_operation_id = step.get("operationId", operation_id)
        if not isinstance(step_operation_id, str) or not step_operation_id:
            raise CliError("operationId 必须是非空字符串", 3, stepIndex=index)
        step["operationId"] = step_operation_id
        step_id = step.get("stepId", "ai-step-%03d" % (index + 1))
        if not isinstance(step_id, str) or not step_id:
            raise CliError("stepId 必须是非空字符串", 3, stepIndex=index)
        if step_id in step_ids:
            raise CliError("同一用例内的 stepId 必须唯一", 3, stepIndex=index, stepId=step_id)
        step_ids.add(step_id)
        step["stepId"] = step_id
        normalized_steps.append(step)

    if active_provider_starts:
        required_stops = {
            "startRecord": "stopRecord",
            "startRecordScreen": "stopRecordScreen",
        }
        raise CliError(
            "动态 Provider 启动动作需要匹配的停止动作",
            3,
            activeProviderActions=sorted(active_provider_starts),
            requiredStopActions=sorted(required_stops[action] for action in active_provider_starts),
        )

    operation_log = {"steps": normalized_steps}
    normalized["operationLog"] = json.dumps(
        operation_log, ensure_ascii=False, separators=(",", ":")
    )
    for generated_field in (
        "id",
        "gmtCreate",
        "gmtModify",
        "selected",
        "caseFingerprint",
    ):
        normalized.pop(generated_field, None)
    return normalized


def load_authoring_case(source: Path) -> Dict[str, Any]:
    """加载并完整校验用例，同时展开为适合继续编辑的结构。"""

    return expand_case_for_authoring(normalize_case(load_json_file(source)))


def authoring_case_steps(case_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    operation_log = case_payload.get("operationLog")
    if not isinstance(operation_log, dict):
        raise CliError("用例 operationLog 必须是可编写对象", 4)
    steps = operation_log.get("steps")
    if not isinstance(steps, list):
        raise CliError("用例 operationLog.steps 必须是数组", 4)
    return steps


def require_case_step_index(index: int, step_count: int, *, insertion: bool = False) -> int:
    upper_bound = step_count if insertion else step_count - 1
    if isinstance(index, bool) or not isinstance(index, int) or index < 0 or index > upper_bound:
        raise CliError(
            "用例步骤索引超出允许范围",
            3,
            index=index,
            minimum=0,
            maximum=upper_bound,
            insertion=insertion,
            stepCount=step_count,
        )
    return index


def case_step_action(step: Dict[str, Any], index: int) -> tuple[str, Optional[str]]:
    method = step.get("operationMethod")
    if not isinstance(method, dict):
        raise CliError("用例步骤的 operationMethod 必须是对象", 3, stepIndex=index)
    raw_action = method.get("actionEnum")
    action_enum = normalize_action_enum(raw_action, index)
    params = method.get("operationParam")
    target_action: Optional[str] = None
    if isinstance(raw_action, str) and raw_action.strip() in PROVIDER_ACTION_BY_CODE:
        target_action = raw_action.strip()
    elif isinstance(params, dict) and isinstance(params.get("targetAction"), str):
        target_action = params["targetAction"].strip() or None
    return action_enum, target_action


def case_step_descriptor(step: Dict[str, Any], index: int) -> Dict[str, Any]:
    action_enum, target_action = case_step_action(step, index)
    enum_descriptor = next(
        item for item in action_catalog() if item["actionEnum"] == action_enum
    )
    provider_descriptor = PROVIDER_ACTION_BY_CODE.get(target_action or "")
    action_code = target_action or enum_descriptor["code"]
    requires_node = (
        bool(provider_descriptor["requiresNode"])
        if provider_descriptor is not None
        else bool(enum_descriptor["requiresNode"])
    )
    high_risk = action_enum in HIGH_RISK_ACTION_REASONS
    return {
        "index": index,
        "stepId": step.get("stepId"),
        "actionCode": action_code,
        "actionEnum": action_enum,
        "targetAction": target_action,
        "requiresNode": requires_node,
        "highRisk": high_risk,
        "highRiskReason": HIGH_RISK_ACTION_REASONS.get(action_enum),
        "requiresHighRiskConfirmation": high_risk,
        "authoringAllowed": (
            action_enum not in PROHIBITED_AUTHORING_ACTION_ENUMS
            and (target_action is None or target_action in PROVIDER_ACTION_BY_CODE)
        ),
        "step": copy.deepcopy(step),
    }


def require_case_step_authoring(
    step: Dict[str, Any],
    index: int,
    *,
    operation: str,
    confirm_high_risk: bool,
    prohibit_preserve_only: bool = True,
) -> str:
    action_enum, target_action = case_step_action(step, index)
    if prohibit_preserve_only and action_enum in PROHIBITED_AUTHORING_ACTION_ENUMS:
        raise CliError(
            "仅保留的 SoloPi 步骤可以查看，但不能编写、导入或回放",
            3,
            operation=operation,
            stepIndex=index,
            actionEnum=action_enum,
            reason=PROHIBITED_AUTHORING_ACTION_REASONS[action_enum],
        )
    if action_enum in DYNAMIC_PROVIDER_ACTION_ENUMS:
        if target_action not in PROVIDER_ACTION_BY_CODE:
            raise CliError(
                "类型化动作目录中不存在该动态 Provider 动作",
                3,
                operation=operation,
                stepIndex=index,
                actionEnum=action_enum,
                targetAction=target_action,
            )
        method = step.get("operationMethod")
        params = method.get("operationParam") if isinstance(method, dict) else None
        if isinstance(params, dict) and isinstance(params.get("url"), str) and params["url"].strip():
            raise CliError(
                "类型化用例编辑不允许编写 Provider 上传 URL",
                3,
                operation=operation,
                stepIndex=index,
                actionEnum=action_enum,
                targetAction=target_action,
            )
    if action_enum in HIGH_RISK_ACTION_REASONS and not confirm_high_risk:
        raise CliError(
            "高风险用例步骤需要传入 --confirm-high-risk",
            3,
            operation=operation,
            stepIndex=index,
            actionEnum=action_enum,
            risk=HIGH_RISK_ACTION_REASONS[action_enum],
        )
    return action_enum


def enforce_case_authoring_policy(
    case_payload: Dict[str, Any],
    *,
    operation: str,
    confirm_high_risk: bool,
    prohibit_preserve_only: bool = True,
) -> List[Dict[str, Any]]:
    """对整份待校验或导入的用例应用与步骤编辑一致的安全策略。"""

    expanded = expand_case_for_authoring(case_payload)
    confirmed_steps: List[Dict[str, Any]] = []
    for index, step in enumerate(authoring_case_steps(expanded)):
        action_enum = require_case_step_authoring(
            step,
            index,
            operation=operation,
            confirm_high_risk=confirm_high_risk,
            prohibit_preserve_only=prohibit_preserve_only,
        )
        if action_enum in HIGH_RISK_ACTION_REASONS:
            confirmed_steps.append(
                {
                    "index": index,
                    "stepId": step.get("stepId"),
                    "actionEnum": action_enum,
                    "risk": HIGH_RISK_ACTION_REASONS[action_enum],
                }
            )
    return confirmed_steps


def required_replay_plugins(case_payload: Dict[str, Any]) -> Dict[str, List[int]]:
    expanded = expand_case_for_authoring(case_payload)
    required: Dict[str, List[int]] = {}
    for index, step in enumerate(authoring_case_steps(expanded)):
        _, target_action = case_step_action(step, index)
        plugin_name = PROVIDER_REQUIRED_PLUGIN.get(target_action or "")
        node = step.get("operationNode")
        if plugin_name is None and isinstance(node, dict) and node.get("nodeType") == "CaptureTree":
            plugin_name = "hulu_imageCompare"
        if plugin_name is not None:
            required.setdefault(plugin_name, []).append(index)
    return required


def unavailable_replay_plugins(
    required: Dict[str, List[int]], response: Dict[str, Any]
) -> List[Dict[str, Any]]:
    validate_plugin_list(response)
    if not response.get("success"):
        raise CliError(
            "SoloPi 在回放前无法列出插件",
            4,
            response=response,
        )
    by_name = {
        plugin["name"]: plugin
        for plugin in response["plugins"]
        if isinstance(plugin, dict) and isinstance(plugin.get("name"), str)
    }
    unavailable: List[Dict[str, Any]] = []
    for name, step_indexes in sorted(required.items()):
        plugin = by_name.get(name)
        if plugin is None or plugin.get("runtimeLoaded") is not True:
            unavailable.append(
                {
                    "name": name,
                    "stepIndexes": step_indexes,
                    "installed": plugin is not None,
                    "runtimeLoaded": bool(plugin and plugin.get("runtimeLoaded") is True),
                }
            )
    return unavailable


def unique_case_step_id(
    steps: Sequence[Dict[str, Any]],
    preferred: Optional[str] = None,
) -> str:
    existing = {
        step.get("stepId")
        for step in steps
        if isinstance(step.get("stepId"), str) and step["stepId"]
    }
    if preferred:
        candidate = preferred
        suffix = 2
        while candidate in existing:
            candidate = "%s-%d" % (preferred, suffix)
            suffix += 1
        return candidate
    candidate_number = 1
    while True:
        candidate = "ai-step-%03d" % candidate_number
        if candidate not in existing:
            return candidate
        candidate_number += 1


def validate_case_edit(case_payload: Dict[str, Any]) -> Dict[str, Any]:
    steps = authoring_case_steps(case_payload)
    for index, step in enumerate(steps):
        step["operationIndex"] = index
    return expand_case_for_authoring(normalize_case(case_payload))


def write_case_edit_output(
    source: Path,
    target: Path,
    payload: Dict[str, Any],
    *,
    overwrite: bool,
) -> str:
    try:
        source_resolved = source.resolve(strict=True)
        target_resolved = target.resolve(strict=False)
    except OSError as exc:
        raise CliError("无法解析用例编辑路径", 3, reason=str(exc)) from exc
    same_file = source_resolved == target_resolved
    if target.exists():
        try:
            same_file = same_file or os.path.samefile(source, target)
        except OSError as exc:
            raise CliError(
                "无法比较用例编辑路径",
                3,
                source=str(source),
                output=str(target),
                reason=str(exc),
            ) from exc
    if same_file:
        raise CliError(
            "用例编辑需要使用不同的输出文件",
            3,
            source=str(source_resolved),
            output=str(target_resolved),
        )
    if target.is_symlink():
        raise CliError("用例编辑输出不能是符号链接", 3, output=str(target))

    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w" if overwrite else "x", encoding="utf-8") as output_file:
            output_file.write(serialized)
    except FileExistsError as exc:
        raise CliError(
            "用例编辑输出已存在；请选择新文件或使用 --overwrite",
            3,
            output=str(target),
        ) from exc
    except OSError as exc:
        raise CliError(
            "无法写入用例编辑输出",
            3,
            output=str(target),
            reason=str(exc),
        ) from exc
    return str(target.resolve())


def load_case_step_file(source: Path) -> Dict[str, Any]:
    step = load_json_file(source)
    if not isinstance(step, dict):
        raise CliError("用例步骤 JSON 必须是对象", 3, file=str(source))
    return copy.deepcopy(step)


def case_edit_result(
    operation: str,
    source: Path,
    output: str,
    case_payload: Dict[str, Any],
    affected_index: int,
    *,
    high_risk_confirmed: bool = False,
) -> Dict[str, Any]:
    steps = authoring_case_steps(case_payload)
    return {
        "success": True,
        "operation": operation,
        "caseName": case_payload["caseName"],
        "source": str(source.resolve()),
        "output": output,
        "stepCount": len(steps),
        "affectedIndex": affected_index,
        "highRiskConfirmed": high_risk_confirmed,
        "step": case_step_descriptor(steps[affected_index], affected_index),
    }


def command_case_step_list(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    source = Path(args.file)
    case_payload = load_authoring_case(source)
    steps = authoring_case_steps(case_payload)
    if args.index is None:
        indexes = range(len(steps))
    else:
        indexes = [require_case_step_index(args.index, len(steps))]
    return {
        "success": True,
        "caseName": case_payload["caseName"],
        "source": str(source.resolve()),
        "stepCount": len(steps),
        "steps": [case_step_descriptor(steps[index], index) for index in indexes],
    }, 0


def command_case_step_add(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    source = Path(args.file)
    case_payload = load_authoring_case(source)
    steps = authoring_case_steps(case_payload)
    insertion_index = len(steps) if args.at is None else args.at
    require_case_step_index(insertion_index, len(steps), insertion=True)
    new_step = load_case_step_file(Path(args.step_file))
    require_case_step_authoring(
        new_step,
        insertion_index,
        operation="add",
        confirm_high_risk=args.confirm_high_risk,
    )
    if "stepId" not in new_step:
        new_step["stepId"] = unique_case_step_id(steps)
    steps.insert(insertion_index, new_step)
    output_case = validate_case_edit(case_payload)
    output = write_case_edit_output(
        source, Path(args.output), output_case, overwrite=args.overwrite
    )
    return case_edit_result(
        "add",
        source,
        output,
        output_case,
        insertion_index,
        high_risk_confirmed=args.confirm_high_risk,
    ), 0


def command_case_step_update(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    source = Path(args.file)
    case_payload = load_authoring_case(source)
    steps = authoring_case_steps(case_payload)
    index = require_case_step_index(args.index, len(steps))
    previous_step = steps[index]
    replacement = load_case_step_file(Path(args.step_file))
    replacement.setdefault("stepId", previous_step["stepId"])
    replacement.setdefault("operationId", previous_step["operationId"])
    require_case_step_authoring(
        replacement,
        index,
        operation="update",
        confirm_high_risk=args.confirm_high_risk,
    )
    steps[index] = replacement
    output_case = validate_case_edit(case_payload)
    output = write_case_edit_output(
        source, Path(args.output), output_case, overwrite=args.overwrite
    )
    return case_edit_result(
        "update",
        source,
        output,
        output_case,
        index,
        high_risk_confirmed=args.confirm_high_risk,
    ), 0


def command_case_step_delete(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    source = Path(args.file)
    case_payload = load_authoring_case(source)
    steps = authoring_case_steps(case_payload)
    index = require_case_step_index(args.index, len(steps))
    if len(steps) == 1:
        raise CliError(
            "A SoloPi case must retain at least one step",
            3,
            stepCount=1,
            index=index,
        )
    removed = steps.pop(index)
    output_case = validate_case_edit(case_payload)
    output = write_case_edit_output(
        source, Path(args.output), output_case, overwrite=args.overwrite
    )
    result = {
        "success": True,
        "operation": "delete",
        "caseName": output_case["caseName"],
        "source": str(source.resolve()),
        "output": output,
        "stepCount": len(authoring_case_steps(output_case)),
        "affectedIndex": index,
        "removedStepId": removed.get("stepId"),
    }
    return result, 0


def command_case_step_move(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    source = Path(args.file)
    case_payload = load_authoring_case(source)
    steps = authoring_case_steps(case_payload)
    source_index = require_case_step_index(args.from_index, len(steps))
    target_index = require_case_step_index(args.to_index, len(steps))
    moving_step = steps[source_index]
    require_case_step_authoring(
        moving_step,
        source_index,
        operation="move",
        confirm_high_risk=args.confirm_high_risk,
    )
    steps.pop(source_index)
    steps.insert(target_index, moving_step)
    output_case = validate_case_edit(case_payload)
    output = write_case_edit_output(
        source, Path(args.output), output_case, overwrite=args.overwrite
    )
    return case_edit_result(
        "move",
        source,
        output,
        output_case,
        target_index,
        high_risk_confirmed=args.confirm_high_risk,
    ), 0


def command_case_step_copy(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    source = Path(args.file)
    case_payload = load_authoring_case(source)
    steps = authoring_case_steps(case_payload)
    source_index = require_case_step_index(args.index, len(steps))
    target_index = require_case_step_index(args.to_index, len(steps), insertion=True)
    copied_step = copy.deepcopy(steps[source_index])
    require_case_step_authoring(
        copied_step,
        source_index,
        operation="copy",
        confirm_high_risk=args.confirm_high_risk,
    )
    copied_step["stepId"] = unique_case_step_id(
        steps, "%s-copy" % copied_step["stepId"]
    )
    steps.insert(target_index, copied_step)
    output_case = validate_case_edit(case_payload)
    output = write_case_edit_output(
        source, Path(args.output), output_case, overwrite=args.overwrite
    )
    return case_edit_result(
        "copy",
        source,
        output,
        output_case,
        target_index,
        high_risk_confirmed=args.confirm_high_risk,
    ), 0


def build_case_template(case_name: str, package_name: str, label: Optional[str]) -> Dict[str, Any]:
    return {
        "caseName": case_name,
        "caseDesc": "AI 编写的 SoloPi 用例",
        "targetAppPackage": package_name,
        "targetAppLabel": label or package_name,
        "recordMode": "local",
        "advanceSettings": "",
        "priority": 2,
        "operationLog": {
            "steps": [
                {
                    "operationNode": None,
                    "operationMethod": {
                        "actionEnum": "SLEEP",
                        "operationParam": {"text": "1000"},
                        "encrypt": False,
                        "safeEncrypt": False,
                    },
                    "operationIndex": 0,
                    "operationId": "ai-%s" % case_name,
                    "stepId": "ai-step-001",
                }
            ]
        },
    }


def session_from_args(
    args: argparse.Namespace,
    adb: AdbClient,
    preserve_foreground: bool = False,
) -> HarnessSession:
    return HarnessSession(
        adb,
        args.package,
        args.device_port,
        args.local_port,
        args.request_timeout,
        args.startup_timeout,
        preserve_foreground,
    )


def validate_adb_connect_status(
    response: Dict[str, Any], expected_request_id: str
) -> None:
    state = response.get("state")
    success = response.get("success")
    connected = response.get("connected")
    terminal = response.get("terminal")
    user_action_required = response.get("userActionRequired")
    required_user_action = response.get("requiredUserAction")
    if (
        not isinstance(success, bool)
        or response.get("requestId") != expected_request_id
        or state not in ADB_CONNECT_STATES
        or not isinstance(connected, bool)
        or not isinstance(terminal, bool)
        or not isinstance(user_action_required, bool)
        or required_user_action is not None
        and (not isinstance(required_user_action, str) or not required_user_action)
    ):
        raise CliError(
            "SoloPi 返回了无效的内部 ADB 连接状态",
            4,
            response=response,
        )

    expected = {
        "success": state != "failed",
        "connected": state == "connected",
        "terminal": state in ADB_CONNECT_TERMINAL_STATES,
    }
    if any(response.get(key) is not value for key, value in expected.items()):
        raise CliError(
            "SoloPi 返回了不一致的内部 ADB 连接状态",
            4,
            response=response,
        )
    if user_action_required is (required_user_action is None):
        raise CliError(
            "SoloPi 返回了不一致的内部 ADB 人工处理提示",
            4,
            response=response,
        )
    if state != "failed" and user_action_required:
        raise CliError(
            "SoloPi 在非失败状态返回了内部 ADB 人工处理提示",
            4,
            response=response,
        )
    if state == "failed" and (
        not isinstance(response.get("errorCode"), str)
        or not response["errorCode"]
        or not isinstance(response.get("error"), str)
        or not response["error"]
    ):
        raise CliError(
            "SoloPi 返回了无效的内部 ADB 连接错误",
            4,
            response=response,
        )


def wait_for_adb_connect_status(
    session: HarnessSession,
    request_id: str,
    timeout: float,
    poll_interval: float,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> Dict[str, Any]:
    if ADB_CONNECT_REQUEST_ID_PATTERN.fullmatch(request_id) is None:
        raise CliError("内部 ADB 连接 requestId 无效", 3, requestId=request_id)
    require_positive_finite(timeout, "内部 ADB 连接超时")
    require_positive_finite(poll_interval, "内部 ADB 轮询间隔")
    deadline = clock() + timeout
    last_status: Optional[Dict[str, Any]] = None
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            break
        request_timeout = min(
            remaining, float(getattr(session, "request_timeout", remaining))
        )
        status = session.adb_connect_status(request_id, timeout=request_timeout)
        if status.get("errorCode") == "adb_connect_receipt_not_found":
            last_status = status
        else:
            validate_adb_connect_status(status, request_id)
            last_status = status
            if status["terminal"]:
                return status
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(poll_interval, remaining))
    raise CliError(
        "等待 SoloPi 内部 ADB 连接超时",
        124,
        requestId=request_id,
        lastStatus=last_status,
        userActionRequired=True,
        requiredUserAction=ADB_CONNECT_REQUIRED_USER_ACTION,
    )


def missing_required_permissions(health: Dict[str, Any]) -> List[str]:
    permissions = health.get("permissions")
    if not isinstance(permissions, dict):
        return sorted(REQUIRED_DOCTOR_PERMISSIONS)
    return sorted(
        key for key in REQUIRED_DOCTOR_PERMISSIONS if permissions.get(key) is not True
    )


def doctor_result_from_health(
    package: str,
    device: Dict[str, Any],
    installed: bool,
    health: Dict[str, Any],
) -> tuple[Dict[str, Any], int]:
    result: Dict[str, Any] = {
        "success": False,
        "device": device,
        "package": package,
        "installed": installed,
        "health": health,
    }
    permissions = health.get("permissions")
    result["missingPermissions"] = missing_required_permissions(health)

    failed_checks = []
    if health.get("appInitialized") is not True:
        failed_checks.append("appInitialized")
    if not isinstance(permissions, dict) or not REQUIRED_DOCTOR_PERMISSIONS.issubset(
        permissions
    ):
        failed_checks.append("permissions")
    if health.get("autoStart") is not True:
        failed_checks.append("autoStart")
    if (
        health.get("ready") is not True
        and not failed_checks
        and not result["missingPermissions"]
    ):
        failed_checks.append("ready")
    result["failedChecks"] = failed_checks
    result["success"] = (
        health.get("ready") is True
        and not result["missingPermissions"]
        and not failed_checks
    )
    if not result["success"]:
        result["error"] = "SoloPi 需要完成一次性设备设置"
    return result, 0 if result["success"] else 2


def command_doctor(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    device = adb.connect()
    installed = adb.package_installed(args.package)
    result: Dict[str, Any] = {
        "success": False,
        "device": device,
        "package": args.package,
        "installed": installed,
    }
    if not installed:
        result["error"] = "未安装 SoloPi"
        return result, 2
    with session_from_args(args, adb) as session:
        health = session.query("health")
        return doctor_result_from_health(args.package, device, installed, health)


def command_adb_connect(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    device = adb.connect()
    installed = adb.package_installed(args.package)
    if not installed:
        return {
            "success": False,
            "connected": False,
            "userActionRequired": True,
            "requiredUserAction": "请先通过已批准的渠道安装兼容的 SoloPi",
            "errorCode": "solopi_not_installed",
            "error": "SoloPi 未安装",
            "device": device,
            "package": args.package,
        }, 2

    with session_from_args(args, adb) as session:
        initial_health = session.query("health")
        initial_doctor, initial_exit_code = doctor_result_from_health(
            args.package, device, installed, initial_health
        )
        if initial_exit_code == 0:
            return {
                "success": True,
                "connected": True,
                "state": "connected",
                "terminal": True,
                "alreadyConnected": True,
                "userActionRequired": False,
                "requiredUserAction": None,
                "doctor": initial_doctor,
            }, 0
        if initial_doctor["missingPermissions"] != ["adb"] or initial_doctor["failedChecks"]:
            return {
                "success": False,
                "connected": False,
                "userActionRequired": True,
                "requiredUserAction": "请先处理 doctor 返回的其他设备就绪项",
                "errorCode": "adb_connect_precondition_failed",
                "error": "内部 ADB 不是唯一未通过的 doctor 检查项",
                "doctor": initial_doctor,
            }, 2

        request_id = str(uuid.uuid4())
        adb.invoke_scheme(
            "harness", {"type": "adb-connect", "requestId": request_id}
        )
        connection = wait_for_adb_connect_status(
            session,
            request_id,
            args.connect_timeout,
            args.poll_interval,
        )
        if not connection["success"]:
            final_health = session.query("health")
            final_doctor, _ = doctor_result_from_health(
                args.package, device, installed, final_health
            )
            result = dict(connection)
            result["alreadyConnected"] = False
            result["doctor"] = final_doctor
            return result, 2

        deadline = time.monotonic() + args.ready_timeout
        final_doctor = initial_doctor
        while True:
            final_health = session.query("health")
            final_doctor, final_exit_code = doctor_result_from_health(
                args.package, device, installed, final_health
            )
            if final_exit_code == 0 or time.monotonic() >= deadline:
                break
            time.sleep(min(args.poll_interval, max(0.0, deadline - time.monotonic())))

        result = dict(connection)
        result["alreadyConnected"] = False
        result["doctor"] = final_doctor
        if final_doctor["success"] is not True:
            result.update({
                "success": False,
                "errorCode": "doctor_not_ready_after_adb_connect",
                "error": "内部 ADB 已连接，但 doctor 门禁仍未通过",
            })
            return result, 2
        return result, 0


def command_query(args: argparse.Namespace, adb: AdbClient, query_type: str) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        result = session.query(query_type)
        return result, 0 if result.get("success", True) else 2


def command_app_status(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        result = session.resolver_get("status", {"type": "status"})
    if not isinstance(result.get("status"), str):
        result.update({"success": False, "error": result.get("error", "应用状态无效")})
        return result, 2
    result["success"] = True
    return result, 0


def command_actions(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    del args, adb
    enum_actions = action_catalog()
    provider_actions = provider_action_catalog()
    return {
        "success": True,
        "counts": {
            "enumActions": len(enum_actions),
            "providerActions": len(provider_actions),
            "totalDescriptors": len(enum_actions) + len(provider_actions),
        },
        "enumActions": enum_actions,
        "providerActions": provider_actions,
    }, 0


def require_non_blank(value: str, label: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise CliError("%s 不能为空" % label, 3)
    return normalized


def command_config_list(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        result = session.config("list")
    validate_config_response(result)
    return result, 0 if result["success"] else 2


def command_config_get(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    key = require_non_blank(args.key, "配置键")
    with session_from_args(args, adb) as session:
        result = session.config("get", key)
    validate_config_response(result, key)
    return result, 0 if result["success"] else 2


def command_config_set(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    key = require_non_blank(args.key, "配置键")
    if not isinstance(args.value, str):
        raise CliError("配置值必须是字符串", 3)
    if key in CLI_UI_ONLY_CONFIG_REASONS:
        return {
            "success": False,
            "error": CLI_UI_ONLY_CONFIG_REASONS[key],
            "errorCode": "ui_confirmation_required",
            "key": key,
        }, 2
    with session_from_args(args, adb) as session:
        current = session.config("get", key)
        validate_config_response(current, key if current.get("success") else None)
        if not current["success"]:
            return current, 2
        config = current["config"]
        if config.get("sensitive") is True:
            return {
                "success": False,
                "error": "敏感配置必须在 SoloPi 应用界面中修改",
                "errorCode": "sensitive_config_ui_required",
                "config": config,
            }, 2
        if key == "KEY_CONTROL_PORT":
            return {
                "success": False,
                "error": "修改控制端口后需要打开新的 CLI 会话",
                "errorCode": "new_session_required",
                "config": config,
            }, 2
        if config.get("writable") is not True:
            return {
                "success": False,
                "error": "该配置需要通过 SoloPi 界面的数据迁移流程修改",
                "errorCode": "ui_migration_required",
                "config": config,
            }, 2
        validate_config_input(config, args.value)
        try:
            adb.invoke_scheme(
                "config",
                {"action": "set", "key": key, "value": args.value},
            )
            result = wait_for_config_value(
                session,
                key,
                args.value,
                args.ack_timeout,
                args.poll_interval,
            )
        except CliError as exc:
            exc.details.setdefault("key", key)
            exc.details.setdefault("expectedValue", args.value)
            exc.details.setdefault("phase", "config-set")
            raise
    return result, 0


def history_limit(raw_limit: int) -> int:
    if isinstance(raw_limit, bool) or not isinstance(raw_limit, int) or not 1 <= raw_limit <= HISTORY_MAX_LIMIT:
        raise CliError(
            "历史记录数量限制必须在 1 到 500 之间",
            3,
            limit=raw_limit,
        )
    return raw_limit


def command_history_list(
    args: argparse.Namespace,
    adb: AdbClient,
    kind: str,
) -> tuple[Dict[str, Any], int]:
    limit = history_limit(args.limit)
    action = "listReplay" if kind == "replay" else "listPerformance"
    with session_from_args(args, adb) as session:
        result = session.history(action, {"limit": str(limit)})
    validate_history_list(result, kind, limit)
    return result, 0 if result["success"] else 2


def command_history_get(
    args: argparse.Namespace,
    adb: AdbClient,
    kind: str,
) -> tuple[Dict[str, Any], int]:
    record_id = history_record_id(args.id, kind)
    action = "getReplay" if kind == "replay" else "getPerformance"
    with session_from_args(args, adb) as session:
        result = session.history(action, {"id": record_id})
    validate_history_detail(result, kind, record_id)
    return result, 0 if result["success"] else 2


def command_history_delete(
    args: argparse.Namespace,
    adb: AdbClient,
    kind: str,
) -> tuple[Dict[str, Any], int]:
    record_id = history_record_id(args.id, kind)
    request_id = str(uuid.uuid4())
    action = "deleteReplay" if kind == "replay" else "deletePerformance"
    with session_from_args(args, adb) as session:
        try:
            adb.invoke_scheme(
                "history",
                {
                    "action": action,
                    "requestId": request_id,
                    "id": record_id,
                    "confirmId": record_id,
                },
            )
            result = wait_for_history_mutation(
                session,
                request_id,
                kind,
                action,
                record_id,
                args.delete_timeout,
                args.poll_interval,
            )
        except CliError as exc:
            exc.details.setdefault("requestId", request_id)
            exc.details.setdefault("kind", kind)
            exc.details.setdefault("id", record_id)
            exc.details.setdefault("phase", "history-delete")
            raise
    if not result["success"]:
        return result, 2
    mutation = result["mutation"]
    return result, 0 if mutation.get("success") is True else 2


def command_plugin_list(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        result = session.plugin("list")
    validate_plugin_list(result)
    return result, 0 if result["success"] else 2


def plugin_cleanup_evidence(
    adb: AdbClient,
    import_path: Optional[str],
    file_name: str,
    pushed: bool,
    invoked: bool,
    terminal_observed: bool,
) -> Dict[str, Any]:
    if not pushed or import_path is None:
        return {
            "attempted": False,
            "success": True,
            "removed": False,
            "fileName": file_name,
            "reason": "not_pushed",
        }
    if invoked and not terminal_observed:
        return {
            "attempted": False,
            "success": False,
            "removed": False,
            "fileName": file_name,
            "reason": "mutation_not_terminal",
        }
    try:
        evidence = adb._remove_whitelisted_plugin_import(import_path, file_name)
    except CliError as exc:
        return {
            "attempted": True,
            "success": False,
            "removed": False,
            "fileName": file_name,
            "reason": "cleanup_error",
            "error": str(exc),
        }
    if not isinstance(evidence, dict):
        return {
            "attempted": True,
            "success": False,
            "removed": False,
            "fileName": file_name,
            "reason": "invalid_cleanup_evidence",
        }
    return evidence


def command_plugin_install(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    request_id = str(uuid.uuid4())
    file_name = generated_plugin_file_name(request_id)
    pushed = False
    invoked = False
    terminal_observed = False
    import_path: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    operation_error: Optional[CliError] = None

    with tempfile.TemporaryDirectory(prefix="solopi-plugin-") as temporary_dir:
        snapshot_path = Path(temporary_dir) / "plugin.zip"
        size_bytes, sha256 = snapshot_plugin_archive(args.file, snapshot_path)
        try:
            with session_from_args(args, adb) as session:
                before = session.plugin("list")
                import_path = validate_plugin_list(before)
                if not before["success"]:
                    result = before
                else:
                    assert import_path is not None
                    if any(
                        candidate.get("fileName") == file_name
                        for candidate in before["importFiles"]
                    ):
                        raise CliError(
                            "生成的插件导入文件已存在",
                            4,
                            requestId=request_id,
                            fileName=file_name,
                        )

                    pushed = True
                    adb._push_plugin_import(snapshot_path, import_path, file_name)
                    after = session.plugin("list")
                    after_path = validate_plugin_list(after)
                    if not after["success"]:
                        raise CliError(
                            "无法校验已推送的插件包",
                            2,
                            response=after,
                        )
                    if after_path != import_path:
                        raise CliError(
                            "安装期间 SoloPi 插件导入路径发生变化",
                            4,
                            requestId=request_id,
                        )
                    candidates = [
                        candidate
                        for candidate in after["importFiles"]
                        if candidate.get("fileName") == file_name
                    ]
                    if len(candidates) != 1 or candidates[0].get("sizeBytes") != size_bytes:
                        raise CliError(
                            "SoloPi 未列出准确匹配的已推送插件包",
                            4,
                            requestId=request_id,
                            fileName=file_name,
                            expectedSizeBytes=size_bytes,
                        )
                    source_file_id = candidates[0]["fileId"]
                    subject = "%s:%s" % (source_file_id, sha256)
                    adb.invoke_scheme(
                        "plugin",
                        {
                            "action": "import",
                            "requestId": request_id,
                            "sha256": sha256,
                            "fileId": source_file_id,
                        },
                    )
                    invoked = True
                    result = wait_for_plugin_mutation(
                        session,
                        request_id,
                        "import",
                        subject,
                        args.install_timeout,
                        args.poll_interval,
                        expected_sha256=sha256,
                        expected_file_id=source_file_id,
                        expected_size=size_bytes,
                    )
                    terminal_observed = bool(
                        result["success"] and result.get("state") in PLUGIN_TERMINAL_STATES
                    )
        except CliError as exc:
            operation_error = exc
        except KeyboardInterrupt:
            operation_error = CliError(
                "安装插件时被中断",
                130,
                requestId=request_id,
            )
        finally:
            cleanup = plugin_cleanup_evidence(
                adb,
                import_path,
                file_name,
                pushed,
                invoked,
                terminal_observed,
            )

    if operation_error is not None:
        operation_error.details.setdefault("requestId", request_id)
        operation_error.details.setdefault("phase", "plugin-install")
        operation_error.details.setdefault("cleanup", cleanup)
        raise operation_error
    assert result is not None
    result["cleanup"] = cleanup
    if not result["success"]:
        return result, 2
    mutation = result["mutation"]
    if mutation.get("success") is True and cleanup.get("success") is not True:
        raise CliError(
            "插件安装已完成，但导入文件清理失败",
            4,
            requestId=request_id,
            phase="plugin-cleanup",
            mutation=result,
            cleanup=cleanup,
        )
    return result, 0 if mutation.get("success") is True else 2


def command_plugin_remove(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    stable_plugin_id = plugin_id(args.id)
    request_id = str(uuid.uuid4())
    with session_from_args(args, adb) as session:
        try:
            adb.invoke_scheme(
                "plugin",
                {
                    "action": "remove",
                    "requestId": request_id,
                    "pluginId": stable_plugin_id,
                    "confirmId": stable_plugin_id,
                },
            )
            result = wait_for_plugin_mutation(
                session,
                request_id,
                "remove",
                stable_plugin_id,
                args.remove_timeout,
                args.poll_interval,
                expected_plugin_id=stable_plugin_id,
            )
        except CliError as exc:
            exc.details.setdefault("requestId", request_id)
            exc.details.setdefault("pluginId", stable_plugin_id)
            exc.details.setdefault("phase", "plugin-remove")
            raise
    if not result["success"]:
        return result, 2
    return result, 0 if result["mutation"].get("success") is True else 2


def command_result(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        result = session.query("result")
    if args.run_id and result.get("runId") != args.run_id:
        return {
            "success": False,
            "error": "最近的 Harness 结果与 --run-id 不匹配",
            "expectedRunId": args.run_id,
            "latestRun": result,
        }, 2
    if not result.get("runId"):
        result.update({"success": False, "error": "没有可用的 Harness 运行结果"})
        return result, 2
    if not result.get("terminal"):
        result.update({"success": False, "error": "Harness 运行尚未进入终态"})
        return result, 2
    result["success"] = result.get("state") == "passed"
    return result, 0 if result["success"] else 2


def command_case_get(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        response = session.query("case", {"caseName": args.case})
    if not response.get("success"):
        return response, 2
    case_payload = response.get("case")
    if not isinstance(case_payload, dict):
        raise CliError("SoloPi 返回的用例载荷无效", 4)
    expanded = expand_case_for_authoring(case_payload)
    result: Dict[str, Any] = {
        "success": True,
        "caseName": expanded.get("caseName"),
        "case": expanded,
    }
    if args.output:
        result["output"] = write_json_file(Path(args.output), expanded)
        result.pop("case")
    return result, 0


def command_case_template(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    del adb
    template = build_case_template(args.name, args.target_package, args.target_label)
    result: Dict[str, Any] = {"success": True, "caseName": args.name, "case": template}
    if args.output:
        result["output"] = write_json_file(Path(args.output), template)
        result.pop("case")
    return result, 0


def command_case_validate(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    del adb
    source = Path(args.file)
    normalized = normalize_case(load_json_file(source))
    confirmed_high_risk_steps = enforce_case_authoring_policy(
        normalized,
        operation="validate",
        confirm_high_risk=args.confirm_high_risk,
    )
    if args.running_params_file is not None:
        running_param = validate_running_param(
            load_json_file(Path(args.running_params_file))
        )
        advance_settings = parse_advance_settings(normalized["advanceSettings"])
        advance_settings["runningParam"] = running_param
        normalized["advanceSettings"] = encode_advance_settings(advance_settings)
    elif args.clear_running_params:
        advance_settings = parse_advance_settings(normalized["advanceSettings"])
        advance_settings.pop("runningParam", None)
        normalized["advanceSettings"] = encode_advance_settings(advance_settings)
    final_advance_settings = parse_advance_settings(normalized["advanceSettings"])
    final_running_param = final_advance_settings.get("runningParam")
    result: Dict[str, Any] = {
        "success": True,
        "valid": True,
        "caseName": normalized["caseName"],
        "stepCount": len(json.loads(normalized["operationLog"])["steps"]),
        "highRiskConfirmed": bool(confirmed_high_risk_steps),
        "confirmedHighRiskSteps": confirmed_high_risk_steps,
        "runningParams": {
            "configured": final_running_param is not None,
            "mode": final_running_param.get("mode") if final_running_param else None,
            "itemCount": len(final_running_param.get("paramList", []))
            if final_running_param
            else 0,
        },
        "case": normalized,
    }
    if args.output:
        result["output"] = write_json_file(Path(args.output), normalized)
        result.pop("case")
    return result, 0


def command_case_import(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    normalized = normalize_case(load_json_file(Path(args.file)))
    enforce_case_authoring_policy(
        normalized,
        operation="import",
        confirm_high_risk=args.confirm_high_risk,
    )
    request_id = str(uuid.uuid4())
    remote_dir = "/sdcard/Android/data/%s/files/harness-import" % args.package
    remote_path = "%s/%s.json" % (remote_dir, request_id)

    with tempfile.TemporaryDirectory(prefix="solopi-ai-") as temporary_dir:
        upload_path = Path(temporary_dir) / "case.json"
        write_json_file(upload_path, normalized)
        with session_from_args(args, adb) as session:
            adb.make_directory(remote_dir)
            adb.push(upload_path, remote_path)
            adb.invoke_scheme(
                "harness",
                {
                    "type": "case-import",
                    "path": remote_path,
                    "replace": str(args.replace).lower(),
                    "requestId": request_id,
                },
            )
            result = wait_for_import_receipt(
                session, request_id, args.import_timeout, args.poll_interval
            )

    if result.get("requestId") != request_id:
        raise CliError(
            "SoloPi 未返回匹配的导入回执",
            4,
            requestId=request_id,
            response=result,
        )
    return result, 0 if result.get("success") else 2


def command_case_delete(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    case_name = require_non_blank(args.case, "用例名称")
    request_id = str(uuid.uuid4())
    with session_from_args(args, adb) as session:
        try:
            adb.invoke_scheme(
                "harness",
                {
                    "type": "case-delete",
                    "caseName": case_name,
                    "confirmCaseName": case_name,
                    "requestId": request_id,
                },
            )
            result = wait_for_case_delete_receipt(
                session,
                request_id,
                args.delete_timeout,
                args.poll_interval,
            )
        except CliError as exc:
            exc.details.setdefault("requestId", request_id)
            exc.details.setdefault("caseName", case_name)
            exc.details.setdefault("phase", "case-delete")
            raise
    if result.get("requestId") != request_id:
        raise CliError(
            "SoloPi 未返回匹配的用例删除回执",
            4,
            requestId=request_id,
            response=result,
        )
    return result, 0 if result.get("success") else 2


def command_inspect(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        result = session.inspect_page()
        return result, 0 if "page" in result else 2


def decode_performance_csv(content: bytes, source: Path) -> tuple[str, str]:
    encodings = (
        ("utf-8-sig", "utf-8-sig")
        if content.startswith(codecs.BOM_UTF8)
        else ("utf-8", "utf-8"),
        ("gbk", "gbk"),
    )
    for codec_name, reported_name in encodings:
        try:
            return content.decode(codec_name, errors="strict"), reported_name
        except UnicodeDecodeError:
            continue
    raise CliError(
        "性能 CSV 编码必须是 UTF-8 或 GBK",
        3,
        file=str(source),
        supportedEncodings=["utf-8", "utf-8-sig", "gbk"],
    )


def descriptive_numeric_column(
    name: str,
    index: int,
    raw_values: Sequence[str],
) -> Dict[str, Any]:
    numeric_values: List[float] = []
    missing_count = 0
    non_numeric_count = 0
    for raw_value in raw_values:
        candidate = raw_value.strip()
        if not candidate:
            missing_count += 1
            continue
        try:
            value = float(candidate)
        except ValueError:
            non_numeric_count += 1
            continue
        if not math.isfinite(value):
            non_numeric_count += 1
            continue
        numeric_values.append(value)

    base: Dict[str, Any] = {
        "index": index,
        "name": name,
        "missingCount": missing_count,
        "nonBlankCount": len(raw_values) - missing_count,
    }
    if non_numeric_count:
        return {
            **base,
            "kind": "skipped",
            "reason": "contains_non_numeric_values",
            "nonNumericCount": non_numeric_count,
        }
    if not numeric_values:
        return {
            **base,
            "kind": "skipped",
            "reason": "no_values",
            "nonNumericCount": 0,
        }

    ordered = sorted(numeric_values)
    sample_count = len(ordered)
    mean_value = math.fsum(value / sample_count for value in ordered)
    middle = sample_count // 2
    median_value = (
        ordered[middle]
        if sample_count % 2
        else ordered[middle - 1] / 2.0 + ordered[middle] / 2.0
    )
    p90_index = max(0, math.ceil(len(ordered) * 0.9) - 1)
    if not math.isfinite(mean_value) or not math.isfinite(median_value):
        raise CliError(
            "性能 CSV 统计值必须保持为有限数字",
            3,
            column=name,
            index=index,
        )
    return {
        **base,
        "kind": "numeric",
        "sampleCount": sample_count,
        "nonNumericCount": 0,
        "min": round(ordered[0], 6),
        "max": round(ordered[-1], 6),
        "mean": round(mean_value, 6),
        "median": round(median_value, 6),
        "p90": round(ordered[p90_index], 6),
    }


def analyze_performance_csv(source: Path, relative_path: str) -> Dict[str, Any]:
    try:
        size_bytes = source.stat().st_size
    except OSError as exc:
        raise CliError(
            "无法检查性能 CSV",
            3,
            file=str(source),
            reason=str(exc),
        ) from exc
    if size_bytes > PERFORMANCE_CSV_MAX_FILE_BYTES:
        raise CliError(
            "性能 CSV 超过单文件大小限制",
            3,
            file=str(source),
            sizeBytes=size_bytes,
            maximumBytes=PERFORMANCE_CSV_MAX_FILE_BYTES,
        )
    try:
        content = source.read_bytes()
    except OSError as exc:
        raise CliError(
            "无法读取性能 CSV",
            3,
            file=str(source),
            reason=str(exc),
        ) from exc
    text, encoding = decode_performance_csv(content, source)
    if "\x00" in text:
        raise CliError("性能 CSV 不能包含 NUL 字节", 3, file=str(source))

    try:
        reader = csv.reader(io.StringIO(text, newline=""), strict=True)
        raw_rows = list(reader)
    except csv.Error as exc:
        raise CliError(
            "性能 CSV 语法无效",
            3,
            file=str(source),
            reason=str(exc),
        ) from exc
    if not raw_rows:
        raise CliError("性能 CSV 必须包含表头行", 3, file=str(source))

    header = [name.strip() for name in raw_rows[0]]
    if not header or any(not name for name in header):
        raise CliError("性能 CSV 表头名称不能为空", 3, file=str(source))
    if len(header) > PERFORMANCE_CSV_MAX_COLUMNS:
        raise CliError(
            "性能 CSV 包含过多列",
            3,
            file=str(source),
            columnCount=len(header),
            maximumColumns=PERFORMANCE_CSV_MAX_COLUMNS,
        )
    duplicate_headers = sorted({name for name in header if header.count(name) > 1})
    if duplicate_headers:
        raise CliError(
            "性能 CSV 包含重复表头名称",
            3,
            file=str(source),
            duplicateHeaders=duplicate_headers,
        )

    data_rows: List[List[str]] = []
    for row_number, raw_row in enumerate(raw_rows[1:], start=2):
        if not raw_row or all(not cell.strip() for cell in raw_row):
            continue
        if len(raw_row) > len(header):
            raise CliError(
                "性能 CSV 数据行的值多于表头列数",
                3,
                file=str(source),
                row=row_number,
                expectedColumns=len(header),
                actualColumns=len(raw_row),
            )
        data_rows.append(raw_row + [""] * (len(header) - len(raw_row)))

    columns = [
        descriptive_numeric_column(
            name,
            index,
            [row[index] for row in data_rows],
        )
        for index, name in enumerate(header)
    ]
    return {
        "path": relative_path,
        "encoding": encoding,
        "sizeBytes": size_bytes,
        "rowCount": len(data_rows),
        "columnCount": len(header),
        "columns": columns,
    }


def performance_csv_files(root: Path) -> tuple[Path, List[tuple[Path, str]]]:
    if root.is_symlink():
        raise CliError(
            "性能证据目录不能是符号链接",
            3,
            input=str(root),
        )
    try:
        resolved_root = root.resolve(strict=True)
    except OSError as exc:
        raise CliError(
            "无法解析性能证据目录",
            3,
            input=str(root),
            reason=str(exc),
        ) from exc
    if not resolved_root.is_dir():
        raise CliError(
            "性能证据输入必须是目录",
            3,
            input=str(resolved_root),
        )

    candidates: List[tuple[Path, str]] = []
    try:
        paths = list(resolved_root.rglob("*"))
    except OSError as exc:
        raise CliError(
            "无法枚举性能证据目录",
            3,
            input=str(resolved_root),
            reason=str(exc),
        ) from exc
    for candidate in paths:
        if candidate.suffix.lower() != ".csv":
            continue
        if candidate.is_symlink() or not candidate.is_file():
            raise CliError(
                "性能 CSV 必须是普通文件，不能是符号链接",
                3,
                file=str(candidate),
            )
        try:
            resolved_candidate = candidate.resolve(strict=True)
            relative_path = resolved_candidate.relative_to(resolved_root).as_posix()
        except (OSError, ValueError) as exc:
            raise CliError(
                "性能 CSV 位于证据目录之外",
                3,
                file=str(candidate),
            ) from exc
        candidates.append((resolved_candidate, relative_path))

    candidates.sort(key=lambda item: item[1])
    if not candidates:
        raise CliError(
            "性能证据目录中没有 CSV 文件",
            3,
            input=str(resolved_root),
        )
    if len(candidates) > PERFORMANCE_CSV_MAX_FILES:
        raise CliError(
            "性能证据目录包含过多 CSV 文件",
            3,
            input=str(resolved_root),
            fileCount=len(candidates),
            maximumFiles=PERFORMANCE_CSV_MAX_FILES,
        )
    try:
        total_bytes = sum(candidate.stat().st_size for candidate, _ in candidates)
    except OSError as exc:
        raise CliError(
            "无法检查性能 CSV 证据",
            3,
            input=str(resolved_root),
            reason=str(exc),
        ) from exc
    if total_bytes > PERFORMANCE_CSV_MAX_TOTAL_BYTES:
        raise CliError(
            "性能 CSV 证据超过总大小限制",
            3,
            input=str(resolved_root),
            totalBytes=total_bytes,
            maximumBytes=PERFORMANCE_CSV_MAX_TOTAL_BYTES,
        )
    return resolved_root, candidates


def command_perf_analyze(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    root, csv_files = performance_csv_files(Path(args.input))
    files = [
        analyze_performance_csv(source, relative_path)
        for source, relative_path in csv_files
    ]
    numeric_column_count = sum(
        1
        for file_result in files
        for column in file_result["columns"]
        if column["kind"] == "numeric"
    )
    skipped_column_count = sum(
        1
        for file_result in files
        for column in file_result["columns"]
        if column["kind"] == "skipped"
    )
    return {
        "success": True,
        "analysisMode": "descriptive-only",
        "sourceDirectory": str(root),
        "percentileMethod": "nearest-rank",
        "summary": {
            "fileCount": len(files),
            "numericColumnCount": numeric_column_count,
            "skippedColumnCount": skipped_column_count,
        },
        "files": files,
        "assessment": {
            "performed": False,
            "reason": "未提供明确阈值契约；本命令只输出描述性统计，不判断是否达标",
        },
    }, 0


def command_startup_time(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    require_positive_finite(args.launch_timeout, "启动耗时采集超时")
    if not math.isfinite(args.interval) or args.interval < 0:
        raise CliError("启动耗时间隔必须是大于等于零的有限数字", 3)
    target_package = validate_android_package(args.target_package)
    adb.connect()
    component = adb.resolve_launcher_component(target_package)
    samples: List[Dict[str, Any]] = []

    for iteration in range(1, args.iterations + 1):
        try:
            sample = adb.measure_startup_time(
                component,
                target_package,
                args.mode,
                args.launch_timeout,
            )
        except CliError as exc:
            exc.details.setdefault("iteration", iteration)
            exc.details.setdefault("targetPackage", target_package)
            exc.details.setdefault("launcherComponent", component)
            exc.details.setdefault("mode", args.mode)
            exc.details.setdefault("validSampleCount", len(samples))
            exc.details.setdefault("completedSamples", samples)
            raise
        samples.append({"iteration": iteration, **sample})
        if iteration < args.iterations and args.interval > 0:
            try:
                time.sleep(args.interval)
            except KeyboardInterrupt as exc:
                raise CliError(
                    "启动耗时测试已中断",
                    130,
                    iteration=iteration,
                    targetPackage=target_package,
                    launcherComponent=component,
                    mode=args.mode,
                    validSampleCount=len(samples),
                    completedSamples=samples,
                ) from exc

    return {
        "success": True,
        "targetPackage": target_package,
        "launcherComponent": component,
        "mode": args.mode,
        "iterations": args.iterations,
        "intervalSeconds": args.interval,
        "launchTimeoutSeconds": args.launch_timeout,
        "validSampleCount": len(samples),
        "unit": "ms",
        "measurement": {
            "source": "Android Activity Manager",
            "command": "adb shell am start -W",
            "warmPreparation": "adb shell am start -W -R 2 的首轮预热",
            "visualCompletion": False,
            "note": "不是 SoloPi 录屏视频差分的视觉完成时间",
        },
        "samples": samples,
        "statistics": startup_time_statistics(samples),
        "percentileMethod": "nearest-rank",
    }, 0


def command_perf_list(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        result = session.performance("listItems")
    validate_performance_envelope(result)
    if result["success"]:
        performance_item_keys(result)
    return result, 0 if result["success"] else 2


def command_perf_current(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        result = session.performance("current")
    validate_performance_status(result)
    if not result["success"]:
        return result, 2
    sampled_at = result.get("sampledAt")
    values = result.get("values")
    if (
        isinstance(sampled_at, bool)
        or not isinstance(sampled_at, int)
        or sampled_at <= 0
        or not isinstance(values, dict)
        or any(not isinstance(key, str) for key in values)
    ):
        raise CliError("SoloPi 返回的当前性能值无效", 4, response=result)
    return result, 0


def command_perf_display_status(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    expected_session_id = None
    if args.session_id is not None:
        expected_session_id = performance_display_session_id(args.session_id)
    with session_from_args(args, adb) as session:
        result = session.performance_display()
    validate_performance_display_status(result)
    if not result["success"]:
        return result, 2
    if expected_session_id and result.get("sessionId") != expected_session_id:
        return {
            "success": False,
            "error": "最近的性能浮窗会话与 --session-id 不匹配",
            "expectedSessionId": expected_session_id,
            "latestPerformanceDisplay": result,
        }, 2
    return result, 0


def command_perf_display_start(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    require_positive_finite(args.ack_timeout, "性能浮窗确认超时")
    require_positive_finite(args.poll_interval, "性能浮窗状态轮询间隔")
    target_package = "-" if args.global_target else validate_android_package(args.target_package)
    requested_items = normalize_performance_items(args.items)

    with session_from_args(args, adb) as session:
        item_response = session.performance("listItems")
        available_items = performance_item_keys(item_response)
        unsupported_items = [item for item in requested_items if item not in available_items]
        if unsupported_items:
            return {
                "success": False,
                "error": "包含不支持的性能浮窗指标",
                "unsupportedItems": unsupported_items,
                "availableItems": available_items,
            }, 2

        before = session.performance_display()
        validate_performance_display_status(before)
        if not before["success"]:
            return before, 2
        if before.get("active"):
            return {
                "success": False,
                "error": "A performance display session is already active",
                "performanceDisplay": before,
            }, 2

        recording = session.performance("status")
        validate_performance_status(recording)
        if not recording["success"]:
            return recording, 2
        if recording.get("active"):
            return {
                "success": False,
                "error": "A performance recording is already active",
                "performance": recording,
            }, 2

        session_id = str(uuid.uuid4())
        try:
            adb.invoke_scheme(
                "performance",
                {
                    "mode": "display",
                    "action": "start",
                    "targetApp": target_package,
                    "items": ",".join(requested_items),
                    "sessionId": session_id,
                },
            )
            result = wait_for_performance_display_state(
                session,
                session_id,
                {"running", "failed"},
                args.ack_timeout,
                args.poll_interval,
                "start",
                ignored_session_id=before.get("sessionId"),
                allow_ignored_session=True,
            )
            if result.get("state") == "running" and (
                result.get("targetPackage") != target_package
                or result.get("items") != requested_items
            ):
                raise CliError(
                    "SoloPi 确认了其他性能浮窗请求",
                    4,
                    sessionId=session_id,
                    expectedTargetPackage=target_package,
                    expectedItems=requested_items,
                    performanceDisplay=result,
                )
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "performance-display-start")
            raise
        except KeyboardInterrupt as exc:
            raise CliError(
                "启动性能浮窗时被中断",
                130,
                sessionId=session_id,
                phase="performance-display-start",
            ) from exc

    result["success"] = result.get("state") == "running"
    return result, 0 if result["success"] else 2


def command_perf_display_stop(
    args: argparse.Namespace,
    adb: AdbClient,
    *,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[Dict[str, Any], int]:
    require_positive_finite(args.stop_timeout, "性能浮窗停止超时")
    require_positive_finite(args.poll_interval, "性能浮窗状态轮询间隔")
    session_id = performance_display_session_id(args.session_id)

    with session_from_args(args, adb) as session:
        current = session.performance_display()
        validate_performance_display_status(current)
        if not current["success"]:
            return current, 2
        if current.get("sessionId") != session_id:
            return {
                "success": False,
                "error": "最近的性能浮窗会话与 --session-id 不匹配",
                "expectedSessionId": session_id,
                "latestPerformanceDisplay": current,
            }, 2

        state = current.get("state")
        stop_deadline = clock() + args.stop_timeout
        cleanup_retries = 0

        def remaining_stop_timeout(status: Dict[str, Any]) -> float:
            remaining = stop_deadline - clock()
            if remaining <= 0:
                raise CliError(
                    "停止性能浮窗超时",
                    124,
                    sessionId=session_id,
                    lastStatus=status,
                )
            return remaining

        def invoke_stop(status: Dict[str, Any]) -> None:
            adb.invoke_scheme(
                "performance",
                {
                    "mode": "display",
                    "action": "stop",
                    "sessionId": session_id,
                },
                timeout=min(30.0, remaining_stop_timeout(status)),
            )

        def retry_incomplete_cleanup(status: Dict[str, Any]) -> None:
            nonlocal cleanup_retries, current
            current = status
            if status.get("state") != "stopping" or status.get("stopRetryable") is not True:
                return
            if cleanup_retries >= PERFORMANCE_DISPLAY_STOP_MAX_CLEANUP_RETRIES:
                raise CliError(
                    "性能浮窗清理达到重试上限",
                    2,
                    sessionId=session_id,
                    cleanupRetries=cleanup_retries,
                    performanceDisplay=status,
                )
            invoke_stop(status)
            cleanup_retries += 1

        try:
            if state in {"starting", "running"}:
                invoke_stop(current)
                current = wait_for_performance_display_state(
                    session,
                    session_id,
                    PERFORMANCE_DISPLAY_TERMINAL_STATES,
                    remaining_stop_timeout(current),
                    args.poll_interval,
                    "stop",
                    clock=clock,
                    sleep=sleep,
                    on_status=retry_incomplete_cleanup,
                )
            elif state == "stopping":
                retry_incomplete_cleanup(current)
                current = wait_for_performance_display_state(
                    session,
                    session_id,
                    PERFORMANCE_DISPLAY_TERMINAL_STATES,
                    remaining_stop_timeout(current),
                    args.poll_interval,
                    "stop",
                    clock=clock,
                    sleep=sleep,
                    on_status=retry_incomplete_cleanup,
                )
            elif state not in PERFORMANCE_DISPLAY_TERMINAL_STATES:
                return {
                    "success": False,
                    "error": "性能浮窗会话既非运行中也非停止中",
                    "performanceDisplay": current,
                }, 2
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "performance-display-stop")
            exc.details.setdefault("performanceDisplay", current)
            raise
        except KeyboardInterrupt as exc:
            raise CliError(
                "停止性能浮窗时被中断",
                130,
                sessionId=session_id,
                phase="performance-display-stop",
                performanceDisplay=current,
            ) from exc

    current["success"] = current.get("state") == "stopped"
    return current, 0 if current["success"] else 2


def command_perf_status(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    expected_session_id = None
    if args.session_id is not None:
        expected_session_id = args.session_id.strip()
        if not expected_session_id:
            raise CliError("性能 sessionId 不能为空", 3)
    with session_from_args(args, adb) as session:
        result = session.performance("status")
    validate_performance_status(result)
    if not result["success"]:
        return result, 2
    if expected_session_id and result.get("sessionId") != expected_session_id:
        return {
            "success": False,
            "error": "最近的性能会话与 --session-id 不匹配",
            "expectedSessionId": expected_session_id,
            "latestPerformance": result,
        }, 2
    return result, 0


def command_perf_start(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    require_positive_finite(args.ack_timeout, "性能录制确认超时")
    require_positive_finite(args.poll_interval, "性能状态轮询间隔")
    target_package = "-" if args.global_target else validate_android_package(args.target_package)
    requested_items = normalize_performance_items(args.items)

    with session_from_args(args, adb) as session:
        item_response = session.performance("listItems")
        available_items = performance_item_keys(item_response)
        unsupported_items = [item for item in requested_items if item not in available_items]
        if unsupported_items:
            return {
                "success": False,
                "error": "包含不支持的性能指标",
                "unsupportedItems": unsupported_items,
                "availableItems": available_items,
            }, 2

        before = session.performance("status")
        validate_performance_status(before)
        if not before["success"]:
            return before, 2
        if before.get("active"):
            return {
                "success": False,
                "error": "A performance recording is already active",
                "performance": before,
            }, 2

        session_id = str(uuid.uuid4())
        try:
            adb.invoke_scheme(
                "performance",
                {
                    "mode": "normal",
                    "action": "start",
                    "targetApp": target_package,
                    "items": ",".join(requested_items),
                    "sessionId": session_id,
                },
            )
            result = wait_for_performance_state(
                session,
                session_id,
                {"recording", "failed"},
                args.ack_timeout,
                args.poll_interval,
                "start",
                ignored_session_id=before.get("sessionId"),
                allow_ignored_session=True,
            )
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "performance-start")
            raise
        except KeyboardInterrupt as exc:
            raise CliError(
                "启动性能录制时被中断",
                130,
                sessionId=session_id,
                phase="performance-start",
            ) from exc

    result["success"] = result.get("state") == "recording"
    return result, 0 if result["success"] else 2


def command_perf_stop(
    args: argparse.Namespace,
    adb: AdbClient,
    *,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[Dict[str, Any], int]:
    require_positive_finite(args.stop_timeout, "性能录制停止超时")
    require_positive_finite(args.poll_interval, "性能状态轮询间隔")
    if not args.session_id.strip():
        raise CliError("必须提供性能 sessionId", 3)
    session_id = args.session_id.strip()
    output = None
    if args.output is not None:
        output = args.output.strip()
        if not output:
            raise CliError("性能输出路径不能为空", 3)
    with session_from_args(args, adb) as session:
        preflight_error = None
        try:
            current = session.performance("status")
        except CliError as exc:
            if not is_control_server_unreachable(exc):
                raise
            preflight_error = exc
            current = {
                "success": False,
                "error": str(exc),
                "sessionId": session_id,
                "transport": exc.details,
            }
        else:
            validate_performance_status(current)
            if not current["success"]:
                return current, 2
            if current.get("sessionId") != session_id:
                return {
                    "success": False,
                    "error": "最近的性能会话与 --session-id 不匹配",
                    "expectedSessionId": session_id,
                    "latestPerformance": current,
                }, 2

        state = None if preflight_error is not None else current.get("state")
        stop_deadline = clock() + args.stop_timeout
        cleanup_retries = 0

        def remaining_stop_timeout(status: Dict[str, Any]) -> float:
            remaining = stop_deadline - clock()
            if remaining <= 0:
                raise CliError(
                    "停止性能录制超时",
                    124,
                    sessionId=session_id,
                    lastStatus=status,
                )
            return remaining

        def invoke_stop(status: Dict[str, Any]) -> None:
            adb.invoke_scheme(
                "performance",
                {
                    "mode": "normal",
                    "action": "stop",
                    "sessionId": session_id,
                },
                timeout=min(30.0, remaining_stop_timeout(status)),
            )

        def retry_incomplete_cleanup(status: Dict[str, Any]) -> None:
            nonlocal cleanup_retries, current
            current = status
            if status.get("state") != "stopping" or status.get("stopRetryable") is not True:
                return
            if cleanup_retries >= PERFORMANCE_STOP_MAX_CLEANUP_RETRIES:
                raise CliError(
                    "性能录制清理达到重试上限",
                    2,
                    sessionId=session_id,
                    cleanupRetries=cleanup_retries,
                    performance=status,
                )
            invoke_stop(status)
            cleanup_retries += 1

        try:
            if preflight_error is not None:
                invoke_stop(current)
                current = wait_for_performance_state(
                    session,
                    session_id,
                    PERFORMANCE_TERMINAL_STATES,
                    remaining_stop_timeout(current),
                    args.poll_interval,
                    "stop recovery",
                    clock=clock,
                    sleep=sleep,
                    on_status=retry_incomplete_cleanup,
                    retry_unreachable=True,
                )
                current["recoveredWithoutPreflight"] = True
            elif state in {"starting", "recording"}:
                invoke_stop(current)
                current = wait_for_performance_state(
                    session,
                    session_id,
                    PERFORMANCE_TERMINAL_STATES,
                    remaining_stop_timeout(current),
                    args.poll_interval,
                    "stop",
                    clock=clock,
                    sleep=sleep,
                    on_status=retry_incomplete_cleanup,
                )
            elif state == "stopping":
                retry_incomplete_cleanup(current)
                current = wait_for_performance_state(
                    session,
                    session_id,
                    PERFORMANCE_TERMINAL_STATES,
                    remaining_stop_timeout(current),
                    args.poll_interval,
                    "stop",
                    clock=clock,
                    sleep=sleep,
                    on_status=retry_incomplete_cleanup,
                )
            elif state not in PERFORMANCE_TERMINAL_STATES:
                return {
                    "success": False,
                    "error": "性能会话既非录制中也非停止中",
                    "performance": current,
                }, 2
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "performance-stop")
            exc.details.setdefault("performance", current)
            raise
        except KeyboardInterrupt as exc:
            raise CliError(
                "停止性能录制时被中断",
                130,
                sessionId=session_id,
                phase="performance-stop",
                performance=current,
            ) from exc

        if current.get("state") == "stopped" and output is not None:
            output_path = current.get("outputPath")
            if not isinstance(output_path, str) or not output_path:
                raise CliError(
                    "SoloPi 未发布性能输出路径",
                    4,
                    performance=current,
                )
            records_root = current.get("recordsRoot")
            try:
                current["artifacts"] = {
                    "performance": pull_performance_output(
                        adb,
                        output_path,
                        records_root,
                        Path(output),
                    )
                }
            except CliError as exc:
                exc.details.setdefault("sessionId", session_id)
                exc.details.setdefault("phase", "performance-artifact-pull")
                exc.details.setdefault("performance", current)
                raise

    current["success"] = current.get("state") == "stopped"
    return current, 0 if current["success"] else 2


def command_record_status(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    expected_session_id = None
    if args.session_id is not None:
        expected_session_id = require_non_blank(args.session_id, "录制 sessionId")
    with session_from_args(args, adb) as session:
        result = session.record("status")
    validate_record_status(result)
    if not result["success"]:
        return result, 2
    if expected_session_id and result.get("sessionId") != expected_session_id:
        return {
            "success": False,
            "error": "最近的录制会话与 --session-id 不匹配",
            "expectedSessionId": expected_session_id,
            "latestRecording": result,
        }, 2
    return result, 0


def command_record_start(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    case_name = require_non_blank(args.name, "录制用例名称")
    target_package = require_non_blank(args.target_package, "录制目标包名")
    with session_from_args(args, adb) as session:
        before = session.record("status")
        validate_record_status(before)
        if not before["success"]:
            return before, 2
        if before.get("active"):
            return {
                "success": False,
                "error": "A recording session is already active",
                "recording": before,
            }, 2

        session_id = str(uuid.uuid4())
        params = {
            "recordMode": "normal",
            "targetApp": target_package,
            "caseName": case_name,
            "sessionId": session_id,
        }
        if args.description is not None:
            params["caseDesc"] = args.description
        try:
            adb.invoke_scheme("record", params)
            result = wait_for_owned_session_state(
                lambda timeout: session.record("status", timeout=timeout),
                validate_record_status,
                session.request_timeout,
                session_id,
                {"recording", "failed"},
                args.ack_timeout,
                args.poll_interval,
                "start",
                "recording",
                ignored_session_id=before.get("sessionId"),
                allow_ignored_session=True,
            )
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "record-start")
            raise
        except KeyboardInterrupt as exc:
            raise CliError(
                "启动录制时被中断",
                130,
                sessionId=session_id,
                phase="record-start",
            ) from exc
    result["success"] = result.get("state") == "recording"
    return result, 0 if result["success"] else 2


def command_record_stop(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    session_id = require_non_blank(args.session_id, "录制 sessionId")
    with session_from_args(args, adb) as session:
        current = session.record("status")
        validate_record_status(current)
        if not current["success"]:
            return current, 2
        if current.get("sessionId") != session_id:
            return {
                "success": False,
                "error": "最近的录制会话与 --session-id 不匹配",
                "expectedSessionId": session_id,
                "latestRecording": current,
            }, 2
        try:
            if current.get("state") in {"starting", "recording"}:
                adb.invoke_scheme(
                    "record",
                    {"recordMode": "stop", "sessionId": session_id},
                )
                current = wait_for_owned_session_state(
                    lambda timeout: session.record("status", timeout=timeout),
                    validate_record_status,
                    session.request_timeout,
                    session_id,
                    RECORD_TERMINAL_STATES,
                    args.stop_timeout,
                    args.poll_interval,
                    "stop",
                    "recording",
                )
            elif current.get("state") == "stopping":
                current = wait_for_owned_session_state(
                    lambda timeout: session.record("status", timeout=timeout),
                    validate_record_status,
                    session.request_timeout,
                    session_id,
                    RECORD_TERMINAL_STATES,
                    args.stop_timeout,
                    args.poll_interval,
                    "stop",
                    "recording",
                )
            elif current.get("state") not in RECORD_TERMINAL_STATES:
                return {
                    "success": False,
                    "error": "录制会话既非活动状态也非终态",
                    "recording": current,
                }, 2
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "record-stop")
            exc.details.setdefault("recording", current)
            raise
    current["success"] = current.get("state") == "stopped"
    return current, 0 if current["success"] else 2


def bounded_scan_cleanup(
    session: HarnessSession,
    adb: AdbClient,
    session_id: str,
    poll_interval: float,
) -> Dict[str, Any]:
    evidence: Dict[str, Any] = {
        "attempted": True,
        "success": False,
        "sessionId": session_id,
    }
    try:
        adb.invoke_scheme("scan", {"action": "cancel", "sessionId": session_id})
        terminal = wait_for_scan_state(
            session,
            session_id,
            SCAN_TERMINAL_STATES,
            SCAN_CLEANUP_TIMEOUT,
            poll_interval,
            "cleanup",
        )
        evidence.update(
            {
                "success": True,
                "terminalState": terminal["state"],
                "contentExecuted": terminal["contentExecuted"],
            }
        )
    except (CliError, KeyboardInterrupt) as exc:
        evidence.update(
            {
                "error": str(exc) or "有界扫码清理期间被中断",
                "exitCode": exc.exit_code if isinstance(exc, CliError) else 130,
            }
        )
    return evidence


def command_scan_status(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    expected_session_id = None
    if args.session_id is not None:
        expected_session_id = scan_session_id(args.session_id)
    with session_from_args(args, adb) as session:
        result = session.scan()
    validate_scan_status(result)
    if not result["success"]:
        return result, 2
    if expected_session_id and result.get("sessionId") != expected_session_id:
        return {
            "success": False,
            "error": "最近的扫码与 --session-id 不匹配",
            "expectedSessionId": expected_session_id,
            "latestScan": result,
        }, 2
    return result, 0 if result.get("state") != "failed" else 2


def command_scan_start(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    with session_from_args(args, adb) as session:
        before = session.scan()
        validate_scan_status(before)
        if not before["success"]:
            return before, 2
        if (
            before.get("active")
            or before.get("manualScanActive")
            or before.get("protocolActivityAttached")
        ):
            return {
                "success": False,
                "error": "A protocol or manual scan page is active or still closing",
                "scan": before,
            }, 2

        session_id = str(uuid.uuid4())
        scan_session_id(session_id)
        start_dispatched = False
        try:
            start_dispatched = True
            adb.invoke_scheme(
                "scan",
                {"action": "start", "sessionId": session_id},
            )
            result = wait_for_scan_state(
                session,
                session_id,
                {
                    "pending-camera-permission",
                    "scanning",
                    "completed",
                    "cancelled",
                    "failed",
                },
                args.ack_timeout,
                args.poll_interval,
                "start",
                ignored_session_id=before.get("sessionId"),
                allow_ignored_session=True,
            )
        except CliError as exc:
            if start_dispatched and exc.exit_code == 124:
                exc.details["cleanup"] = bounded_scan_cleanup(
                    session, adb, session_id, args.poll_interval
                )
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "scan-start")
            raise
        except KeyboardInterrupt as exc:
            cleanup = (
                bounded_scan_cleanup(session, adb, session_id, args.poll_interval)
                if start_dispatched
                else {"attempted": False, "success": True, "reason": "not_dispatched"}
            )
            raise CliError(
                "启动扫码时被中断",
                130,
                sessionId=session_id,
                phase="scan-start",
                cleanup=cleanup,
            ) from exc

    accepted = result.get("state") in {
        "pending-camera-permission",
        "scanning",
        "completed",
    }
    if accepted:
        return result, 0
    return {
        "success": False,
        "error": "扫码未进入可用状态",
        "scan": result,
    }, 2


def command_scan_cancel(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    session_id = scan_session_id(args.session_id)
    with session_from_args(args, adb) as session:
        current = session.scan()
        validate_scan_status(current)
        if not current["success"]:
            return current, 2
        if current.get("sessionId") != session_id:
            return {
                "success": False,
                "error": "最近的扫码与 --session-id 不匹配",
                "expectedSessionId": session_id,
                "latestScan": current,
            }, 2
        try:
            if current.get("state") in SCAN_ACTIVE_STATES:
                adb.invoke_scheme(
                    "scan",
                    {"action": "cancel", "sessionId": session_id},
                )
                current = wait_for_scan_state(
                    session,
                    session_id,
                    SCAN_TERMINAL_STATES,
                    args.cancel_timeout,
                    args.poll_interval,
                    "cancel",
                )
            elif current.get("state") == "cancelled":
                return current, 0
            else:
                return {
                    "success": False,
                    "error": "扫码已进入终态，无法取消",
                    "scan": current,
                }, 2
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "scan-cancel")
            exc.details.setdefault("scan", current)
            raise
        except KeyboardInterrupt as exc:
            raise CliError(
                "取消扫码时被中断",
                130,
                sessionId=session_id,
                phase="scan-cancel",
                scan=current,
            ) from exc

    if current.get("state") == "cancelled":
        return current, 0
    return {
        "success": False,
        "error": "取消生效前扫码已完成或失败",
        "scan": current,
    }, 2


def bounded_screen_record_cleanup(
    session: HarnessSession,
    adb: AdbClient,
    session_id: str,
    poll_interval: float,
    expected_captures_root: Optional[str] = None,
) -> Dict[str, Any]:
    evidence: Dict[str, Any] = {
        "attempted": True,
        "success": False,
        "sessionId": session_id,
    }
    try:
        adb.invoke_scheme(
            "screen-record",
            {"action": "stop", "sessionId": session_id},
        )
        terminal = wait_for_screen_record_state(
            session,
            session_id,
            SCREEN_RECORD_TERMINAL_STATES,
            SCREEN_RECORD_CLEANUP_TIMEOUT,
            poll_interval,
            "cleanup",
            expected_captures_root=expected_captures_root,
        )
        evidence.update(
            {
                "success": True,
                "terminalState": terminal["state"],
                "cancelledBeforeStart": terminal["cancelledBeforeStart"],
            }
        )
    except (CliError, KeyboardInterrupt) as exc:
        evidence.update(
            {
                "error": str(exc) or "有界清理期间被中断",
                "exitCode": exc.exit_code if isinstance(exc, CliError) else 130,
            }
        )
    return evidence


def command_screen_record_status(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    expected_session_id = None
    if args.session_id is not None:
        expected_session_id = screen_record_session_id(args.session_id)
    with session_from_args(args, adb) as session:
        result = session.screen_record("status")
    validate_screen_record_status(result)
    if not result["success"]:
        return result, 2
    if expected_session_id and result.get("sessionId") != expected_session_id:
        return {
            "success": False,
            "error": "最近的录屏与 --session-id 不匹配",
            "expectedSessionId": expected_session_id,
            "latestScreenRecording": result,
        }, 2
    return result, 0


def command_screen_record_start(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    config = validate_screen_record_config(args)
    with session_from_args(args, adb) as session:
        before = session.screen_record("status")
        validate_screen_record_status(before)
        if not before["success"]:
            return before, 2
        if before.get("active"):
            return {
                "success": False,
                "error": "A screen recording session is already active",
                "screenRecording": before,
            }, 2

        session_id = str(uuid.uuid4())
        screen_record_session_id(session_id)
        start_dispatched = False
        expected_root: Optional[str] = None
        try:
            start_dispatched = True
            adb.invoke_scheme(
                "screen-record",
                {"action": "start", "sessionId": session_id, **config},
            )
            result = wait_for_screen_record_state(
                session,
                session_id,
                {"recording", "failed"},
                args.ack_timeout,
                args.poll_interval,
                "start",
                ignored_session_id=before.get("sessionId"),
                allow_ignored_session=True,
            )
        except CliError as exc:
            last_status = exc.details.get("lastStatus")
            if isinstance(last_status, dict) and last_status.get("sessionId") == session_id:
                expected_root = last_status.get("capturesRoot")
            if start_dispatched and exc.exit_code == 124:
                exc.details["cleanup"] = bounded_screen_record_cleanup(
                    session,
                    adb,
                    session_id,
                    args.poll_interval,
                    expected_captures_root=expected_root,
                )
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "screen-record-start")
            raise
        except KeyboardInterrupt as exc:
            cleanup = (
                bounded_screen_record_cleanup(
                    session,
                    adb,
                    session_id,
                    args.poll_interval,
                )
                if start_dispatched
                else {"attempted": False, "success": True, "reason": "not_dispatched"}
            )
            raise CliError(
                "启动录屏时被中断",
                130,
                sessionId=session_id,
                phase="screen-record-start",
                cleanup=cleanup,
            ) from exc
    result["success"] = result.get("state") == "recording"
    return result, 0 if result["success"] else 2


def command_screen_record_stop(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    session_id = screen_record_session_id(args.session_id)
    output = Path(args.output) if args.output is not None else None
    if output is not None and (output.exists() or output.is_symlink()):
        raise CliError("录屏输出路径已存在", 3, output=str(output))

    with session_from_args(args, adb) as session:
        current = session.screen_record("status")
        validate_screen_record_status(current)
        if not current["success"]:
            return current, 2
        if current.get("sessionId") != session_id:
            return {
                "success": False,
                "error": "最近的录屏与 --session-id 不匹配",
                "expectedSessionId": session_id,
                "latestScreenRecording": current,
            }, 2

        try:
            if current.get("state") in {
                "pending-user-confirmation",
                "starting",
                "recording",
            }:
                adb.invoke_scheme(
                    "screen-record",
                    {"action": "stop", "sessionId": session_id},
                )
                current = wait_for_screen_record_state(
                    session,
                    session_id,
                    SCREEN_RECORD_TERMINAL_STATES,
                    args.stop_timeout,
                    args.poll_interval,
                    "stop",
                    expected_captures_root=current.get("capturesRoot"),
                )
            elif current.get("state") == "stopping":
                current = wait_for_screen_record_state(
                    session,
                    session_id,
                    SCREEN_RECORD_TERMINAL_STATES,
                    args.stop_timeout,
                    args.poll_interval,
                    "stop",
                    expected_captures_root=current.get("capturesRoot"),
                )
            elif current.get("state") not in SCREEN_RECORD_TERMINAL_STATES:
                return {
                    "success": False,
                    "error": "录屏会话既非活动状态也非终态",
                    "screenRecording": current,
                }, 2
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "screen-record-stop")
            exc.details.setdefault("screenRecording", current)
            raise
        except KeyboardInterrupt as exc:
            raise CliError(
                "停止录屏时被中断",
                130,
                sessionId=session_id,
                phase="screen-record-stop",
                screenRecording=current,
            ) from exc

        if (
            output is not None
            and current.get("state") == "stopped"
            and current.get("cancelledBeforeStart") is not True
        ):
            try:
                current["artifacts"] = {
                    "screenRecording": pull_screen_record_output(
                        adb,
                        current.get("outputPath"),
                        current.get("capturesRoot"),
                        current.get("fileSize"),
                        output,
                    )
                }
            except CliError as exc:
                exc.details.setdefault("sessionId", session_id)
                exc.details.setdefault("phase", "screen-record-artifact-pull")
                exc.details.setdefault("screenRecording", current)
                raise

    current["success"] = current.get("state") == "stopped"
    return current, 0 if current["success"] else 2


def command_video_analysis_status(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    request_id = video_analysis_request_id(args.request_id)
    with session_from_args(args, adb) as session:
        result = session.video_analysis(request_id)
    validate_video_analysis_response(result, request_id)
    return result, 0 if result.get("state") in {"analyzing", "completed"} else 2


def command_video_analysis_start(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    video_path = validate_video_analysis_device_path(args.video_path)
    action_offset = args.action_offset_ms
    threshold = args.difference_threshold
    if (
        isinstance(action_offset, bool)
        or not isinstance(action_offset, int)
        or not 0 <= action_offset <= VIDEO_ANALYSIS_MAX_ACTION_OFFSET_MS
    ):
        raise CliError(
            "视频动作偏移必须在 0 到 %d 毫秒之间"
            % VIDEO_ANALYSIS_MAX_ACTION_OFFSET_MS,
            3,
            actionOffsetMs=action_offset,
        )
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not math.isfinite(float(threshold))
        or not 0 < float(threshold) <= 1
    ):
        raise CliError(
            "视频差异阈值必须大于 0 且不超过 1",
            3,
            differenceThreshold=threshold,
        )

    request_id = video_analysis_request_id(str(uuid.uuid4()))
    params = {
        "action": "start",
        "requestId": request_id,
        "videoPath": video_path,
        "actionOffsetMs": str(action_offset),
        "differenceThreshold": format(float(threshold), ".15g"),
    }
    try:
        with session_from_args(args, adb) as session:
            adb.invoke_scheme("video-analysis", params)
            result = wait_for_video_analysis(
                session,
                request_id,
                args.ack_timeout,
                args.poll_interval,
                require_terminal=False,
            )
            if result.get("state") is not None:
                if (
                    result.get("videoFileName") != PurePosixPath(video_path).name
                    or result.get("actionOffsetMs") != action_offset
                    or float(result.get("differenceThreshold"))
                    != float(params["differenceThreshold"])
                ):
                    raise CliError(
                        "SoloPi 视频分析回执与启动请求不一致",
                        4,
                        requestId=request_id,
                        request=params,
                        response=result,
                    )
            if (
                args.wait
                and result.get("state") not in VIDEO_ANALYSIS_TERMINAL_STATES
                and result.get("success") is True
            ):
                result = wait_for_video_analysis(
                    session,
                    request_id,
                    args.analysis_timeout,
                    args.poll_interval,
                    require_terminal=True,
                )
    except CliError as exc:
        exc.details.setdefault("requestId", request_id)
        exc.details.setdefault("phase", "video-analysis-start")
        raise
    return result, 0 if result.get("state") in {"analyzing", "completed"} else 2


def validate_stress_request(args: argparse.Namespace, adb: AdbClient) -> Dict[str, int]:
    cpu_count = 0 if args.cpu_count is None else args.cpu_count
    cpu_percent = 0 if args.cpu_percent is None else args.cpu_percent
    memory = 0 if args.memory is None else args.memory
    duration = args.duration
    if (args.cpu_count is None) != (args.cpu_percent is None):
        raise CliError("--cpu-count 和 --cpu-percent 必须同时提供", 3)
    max_cpu_count = adb.processor_count() if args.cpu_count is not None else None
    if cpu_count < 0 or (max_cpu_count is not None and cpu_count > max_cpu_count):
        raise CliError(
            "CPU 压力线程数超出设备限制",
            3,
            cpuCount=cpu_count,
            maxCpuCount=max_cpu_count,
        )
    if cpu_percent < 0 or cpu_percent > STRESS_MAX_CPU_PERCENT:
        raise CliError(
            "CPU 压力百分比必须在 0 到 100 之间",
            3,
            cpuPercent=cpu_percent,
        )
    if cpu_count == 0 and args.cpu_count is not None:
        raise CliError("CPU 压力线程数必须大于零", 3)
    if cpu_percent == 0 and args.cpu_percent is not None:
        raise CliError("CPU 压力百分比必须大于零", 3)
    if memory < 0 or memory > STRESS_MAX_MEMORY_MB:
        raise CliError(
            "内存压力值超出安全限制",
            3,
            memory=memory,
            maxMemory=STRESS_MAX_MEMORY_MB,
        )
    if memory == 0 and args.memory is not None:
        raise CliError("内存压力值必须大于零", 3)
    if cpu_count == 0 and memory == 0:
        raise CliError("至少需要配置 CPU 或内存压力", 3)
    if duration < 1 or duration > STRESS_MAX_DURATION_SECONDS:
        raise CliError(
            "压力持续时间超出安全限制",
            3,
            duration=duration,
            maxDuration=STRESS_MAX_DURATION_SECONDS,
        )
    return {
        "cpuCount": cpu_count,
        "cpuPercent": cpu_percent,
        "memory": memory,
        "durationSec": duration,
    }


def command_stress_status(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    expected_session_id = None
    if args.session_id is not None:
        expected_session_id = require_non_blank(args.session_id, "压力会话 sessionId")
    with session_from_args(args, adb) as session:
        result = session.stress("status")
    validate_stress_status(result)
    if not result["success"]:
        return result, 2
    if expected_session_id and result.get("sessionId") != expected_session_id:
        return {
            "success": False,
            "error": "最近的压力会话与 --session-id 不匹配",
            "expectedSessionId": expected_session_id,
            "latestStress": result,
        }, 2
    return result, 0


def command_stress_start(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    requested = validate_stress_request(args, adb)
    with session_from_args(args, adb) as session:
        before = session.stress("status")
        validate_stress_status(before)
        if not before["success"]:
            return before, 2
        if before.get("active"):
            return {
                "success": False,
                "error": "已有活动的压力会话",
                "stress": before,
            }, 2
        session_id = str(uuid.uuid4())
        params = {"action": "start", "sessionId": session_id}
        params.update({key: str(value) for key, value in requested.items()})
        try:
            adb.invoke_scheme("stress", params)
            result = wait_for_owned_session_state(
                lambda timeout: session.stress("status", timeout=timeout),
                validate_stress_status,
                session.request_timeout,
                session_id,
                {"running", "failed"},
                args.ack_timeout,
                args.poll_interval,
                "start",
                "stress",
                ignored_session_id=before.get("sessionId"),
                allow_ignored_session=True,
            )
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "stress-start")
            raise
        except KeyboardInterrupt as exc:
            raise CliError(
                "启动压力任务时被中断",
                130,
                sessionId=session_id,
                phase="stress-start",
            ) from exc
    result["success"] = result.get("state") == "running"
    return result, 0 if result["success"] else 2


def command_stress_stop(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    session_id = require_non_blank(args.session_id, "压力会话 sessionId")
    with session_from_args(args, adb) as session:
        current = session.stress("status")
        validate_stress_status(current)
        if not current["success"]:
            return current, 2
        if current.get("sessionId") != session_id:
            return {
                "success": False,
                "error": "最近的压力会话与 --session-id 不匹配",
                "expectedSessionId": session_id,
                "latestStress": current,
            }, 2
        try:
            if current.get("state") in STRESS_ACTIVE_STATES:
                adb.invoke_scheme(
                    "stress",
                    {"action": "stop", "sessionId": session_id},
                )
                current = wait_for_owned_session_state(
                    lambda timeout: session.stress("status", timeout=timeout),
                    validate_stress_status,
                    session.request_timeout,
                    session_id,
                    STRESS_TERMINAL_STATES,
                    args.stop_timeout,
                    args.poll_interval,
                    "stop",
                    "stress",
                )
            elif current.get("state") not in STRESS_TERMINAL_STATES:
                return {
                    "success": False,
                    "error": "压力会话既非活动状态也非终态",
                    "stress": current,
                }, 2
        except CliError as exc:
            exc.details.setdefault("sessionId", session_id)
            exc.details.setdefault("phase", "stress-stop")
            exc.details.setdefault("stress", current)
            raise
    current["success"] = current.get("state") == "stopped"
    return current, 0 if current["success"] else 2


def command_cancel(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    expected_run_id = require_non_blank(args.run_id, "Harness runId")
    with session_from_args(args, adb) as session:
        before = session.query("status")
        if not before.get("active"):
            return {
                "success": False,
                "error": "指定的 Harness 运行不处于活动状态",
                "expectedRunId": expected_run_id,
                "activeRun": before,
            }, 2
        run_id = before.get("runId")
        if not isinstance(run_id, str) or not run_id:
            raise CliError("SoloPi 返回活动回放但缺少 runId", 4, run=before)
        if run_id != expected_run_id:
            return {
                "success": False,
                "error": "活动的 Harness 运行与 --run-id 不匹配",
                "expectedRunId": expected_run_id,
                "activeRun": before,
            }, 2
        adb.invoke_scheme("harness", {"type": "cancel", "runId": run_id})
        result = wait_for_terminal_run(
            session, run_id, args.cancel_timeout, args.poll_interval
        )
        return result, 0 if result.get("state") == "cancelled" else 2


def replay_request_params(args: argparse.Namespace) -> tuple[str, Dict[str, str]]:
    case_name = require_non_blank(args.case, "用例名称")
    params = {"replayMode": "normal", "caseName": case_name}
    target_package = getattr(args, "target_package", None)
    if target_package is not None:
        params["targetApp"] = validate_android_package(target_package)
    restart_app = getattr(args, "restart_app", None)
    if restart_app is not None:
        if not isinstance(restart_app, bool):
            raise CliError("提供 restartApp 时，其值必须是布尔值", 3)
        params["restartApp"] = str(restart_app).lower()
    return case_name, params


def command_run(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    case_name, replay_params = replay_request_params(args)
    replay_request_id = "replay-" + uuid.uuid4().hex
    replay_params["requestId"] = replay_request_id
    with session_from_args(args, adb) as session:
        case_response = session.query("case", {"caseName": case_name})
        if not case_response.get("success"):
            return case_response, 2
        case_payload = case_response.get("case")
        if not isinstance(case_payload, dict):
            raise CliError(
                "SoloPi 在回放前返回的用例载荷无效",
                4,
                caseName=case_name,
            )
        if case_payload.get("caseName") != case_name:
            raise CliError(
                "SoloPi 在回放前返回了其他用例",
                4,
                expectedCaseName=case_name,
                actualCaseName=case_payload.get("caseName"),
            )
        case_id = case_payload.get("id")
        case_fingerprint = case_payload.get("caseFingerprint")
        if isinstance(case_id, bool) or not isinstance(case_id, int) or case_id <= 0:
            raise CliError(
                "SoloPi 在回放前返回的用例 ID 无效",
                4,
                caseName=case_name,
                caseId=case_id,
            )
        if not isinstance(case_fingerprint, str) or CASE_FINGERPRINT_PATTERN.fullmatch(
            case_fingerprint
        ) is None:
            raise CliError(
                "SoloPi 在回放前返回的用例指纹无效",
                4,
                caseName=case_name,
            )
        replay_params["caseId"] = str(case_id)
        replay_params["caseFingerprint"] = case_fingerprint
        confirmed_high_risk_steps = enforce_case_authoring_policy(
            case_payload,
            operation="run",
            confirm_high_risk=args.confirm_high_risk,
        )
        required_plugins = required_replay_plugins(case_payload)
        if required_plugins:
            plugin_response = session.plugin("list")
            unavailable_plugins = unavailable_replay_plugins(
                required_plugins, plugin_response
            )
            if unavailable_plugins:
                return {
                    "success": False,
                    "error": (
                        "回放要求插件已在本地安装并加载；"
                        "已禁用自动远程下载插件"
                    ),
                    "caseName": case_name,
                    "unavailablePlugins": unavailable_plugins,
                }, 2
        if not args.no_auto_start:
            adb.invoke_scheme(
                "config",
                {"key": "KEY_REPLAY_AUTO_START", "value": "true"},
            )
        health = session.query("health")
        if args.no_auto_start and health.get("autoStart") is not True:
            return {
                "success": False,
                "error": "回放自动启动已禁用；请在 SoloPi 中启用，或移除 --no-auto-start",
                "health": health,
            }, 2
        missing_permissions = missing_required_permissions(health)
        if missing_permissions:
            return {
                "success": False,
                "error": "SoloPi 权限尚未就绪",
                "missingPermissions": missing_permissions,
                "health": health,
            }, 2

        before = session.query("status")
        if before.get("active"):
            return {"success": False, "error": "已有回放正在运行", "run": before}, 2

        adb.invoke_scheme("replay", replay_params)
        current = wait_for_new_run(
            session,
            replay_request_id,
            before.get("runId"),
            case_name,
            args.ack_timeout,
            args.poll_interval,
        )
        if not args.wait:
            current["confirmedHighRiskSteps"] = confirmed_high_risk_steps
            return current, 0 if current.get("active") else 2

        if current.get("state") not in TERMINAL_STATES:
            try:
                current = wait_for_terminal_run(
                    session,
                    str(current.get("runId")),
                    args.run_timeout,
                    args.poll_interval,
                )
            except CliError as exc:
                if exc.exit_code == 124 and args.artifacts:
                    timeout_status = exc.details.get("lastStatus") or session.query("status")
                    exc.details["artifacts"] = collect_artifacts(
                        adb, timeout_status, Path(args.artifacts)
                    )
                raise
        if args.artifacts:
            current["artifacts"] = collect_artifacts(adb, current, Path(args.artifacts))
        current["confirmedHighRiskSteps"] = confirmed_high_risk_steps
        current["success"] = current.get("state") == "passed"
        return current, 0 if current["success"] else 2


def evidence_segment(case_name: str) -> str:
    segment = re.sub(r"[^A-Za-z0-9._-]+", "-", case_name).strip("-.")
    return (segment or "case")[:80]


def cli_error_payload(error: CliError) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"success": False, "error": str(error)}
    payload.update(error.details)
    return payload


def command_run_sequence(
    args: argparse.Namespace,
    adb: AdbClient,
    case_names: Sequence[str],
) -> tuple[Dict[str, Any], int]:
    normalized_cases = [require_non_blank(case_name, "用例名称") for case_name in case_names]
    batch_id = str(uuid.uuid4())
    batch_artifact_root: Optional[Path] = None
    if args.artifacts:
        requested_root = Path(args.artifacts)
        batch_artifact_root = requested_root / ("batch-%s" % batch_id)
        if batch_artifact_root.exists():
            raise CliError(
                "批量运行证据路径已存在",
                3,
                batchId=batch_id,
                artifacts=str(batch_artifact_root),
            )

    results: List[Dict[str, Any]] = []
    infrastructure_exit_code: Optional[int] = None
    for index, case_name in enumerate(normalized_cases):
        child_args = copy.copy(args)
        child_args.command = "run"
        child_args.case = case_name
        child_args.wait = True
        if batch_artifact_root is not None:
            child_args.artifacts = str(
                batch_artifact_root / ("%03d-%s" % (index + 1, evidence_segment(case_name)))
            )
        else:
            child_args.artifacts = None
        try:
            child_result, child_exit_code = command_run(child_args, adb)
        except CliError as exc:
            child_result = cli_error_payload(exc)
            child_exit_code = exc.exit_code
            if child_exit_code not in {0, 2} and infrastructure_exit_code is None:
                infrastructure_exit_code = child_exit_code
        results.append(
            {
                "index": index + 1,
                "caseName": case_name,
                "exitCode": child_exit_code,
                "run": child_result,
            }
        )
        if child_exit_code != 0 and not args.continue_on_failure:
            break

    completed_all = len(results) == len(normalized_cases)
    successful = completed_all and all(item["exitCode"] == 0 for item in results)
    payload: Dict[str, Any] = {
        "success": successful,
        "batchId": batch_id,
        "requestedRuns": len(normalized_cases),
        "completedRuns": len(results),
        "stoppedEarly": not completed_all,
        "continueOnFailure": args.continue_on_failure,
        "results": results,
    }
    if batch_artifact_root is not None:
        payload["artifactsRoot"] = str(batch_artifact_root.resolve())
    if not successful:
        payload["failedRuns"] = sum(item["exitCode"] != 0 for item in results)
    return payload, 0 if successful else (infrastructure_exit_code or 2)


def command_run_repeat(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    return command_run_sequence(args, adb, [args.case] * args.times)


def command_run_batch(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    return command_run_sequence(args, adb, args.case)


def validate_agent_id(value: str, label: str) -> str:
    normalized = require_non_blank(value, label)
    if not AGENT_ID_PATTERN.fullmatch(normalized):
        raise CliError("%s 格式无效" % label, 3)
    return normalized


def validate_agent_owner_token(value: str) -> str:
    normalized = require_non_blank(value, "ownerToken")
    if not AGENT_OWNER_TOKEN_PATTERN.fullmatch(normalized):
        raise CliError(
            "ownerToken 必须包含 16 到 160 个 URL 安全字符",
            3,
        )
    return normalized


def best_effort_agent_cancel(
    adb: AdbClient,
    session_id: Optional[str],
    owner_token: str,
) -> Dict[str, Any]:
    evidence: Dict[str, Any] = {
        "attempted": bool(session_id),
        "success": False,
        "sessionId": session_id,
    }
    if not session_id:
        evidence["reason"] = "session_id_unavailable"
        return evidence
    try:
        invoke_agent_mutation(
            adb,
            {
                "type": "cancel",
                "sessionId": session_id,
                "ownerToken": owner_token,
            },
            timeout=10,
        )
        evidence["success"] = True
    except Exception as exc:
        evidence["reason"] = str(exc)
    return evidence


def invoke_agent_mutation(
    adb: AdbClient,
    params: Dict[str, str],
    timeout: float,
) -> str:
    foreground = adb.foreground_component()
    try:
        return adb.invoke_scheme("agent", params, timeout=timeout)
    finally:
        if foreground:
            adb.restore_foreground(foreground)


def command_agent_session_start(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    bounds = (
        ("maxSteps", args.max_steps, 1, 200),
        ("maxDurationMs", args.max_duration_ms, 1000, 1_800_000),
        ("idleTimeoutMs", args.idle_timeout_ms, 1000, 300_000),
        ("maxRepeatedActions", args.max_repeated_actions, 1, 20),
        ("maxNoProgressSteps", args.max_no_progress_steps, 1, 20),
    )
    for label, value, minimum, maximum in bounds:
        if not minimum <= value <= maximum:
            raise CliError(
                "%s must be between %d and %d" % (label, minimum, maximum),
                3,
            )
    owner_token = validate_agent_owner_token(
        args.owner_token or (uuid.uuid4().hex + uuid.uuid4().hex)
    )
    mutation = {
        "type": "start",
        "ownerToken": owner_token,
        "maxSteps": str(args.max_steps),
        "maxDurationMs": str(args.max_duration_ms),
        "idleTimeoutMs": str(args.idle_timeout_ms),
        "maxRepeatedActions": str(args.max_repeated_actions),
        "maxNoProgressSteps": str(args.max_no_progress_steps),
    }
    session_id: Optional[str] = None
    with session_from_args(args, adb, preserve_foreground=True) as session:
        try:
            invoke_agent_mutation(adb, mutation, timeout=args.ack_timeout)
            deadline = time.monotonic() + args.ack_timeout
            last_status: Optional[Dict[str, Any]] = None
            while time.monotonic() < deadline:
                last_status = session.agent(
                    "start-status",
                    {"ownerToken": owner_token},
                    timeout=session.request_timeout,
                )
                if not last_status.get("success"):
                    if last_status.get("errorCode") == "session_not_found":
                        time.sleep(args.poll_interval)
                        continue
                    return last_status, 2
                agent_session = last_status.get("session")
                if not isinstance(agent_session, dict):
                    raise CliError("Agent 启动状态缺少会话信息", 4)
                raw_session_id = agent_session.get("sessionId")
                if isinstance(raw_session_id, str):
                    session_id = raw_session_id
                if agent_session.get("state") in AGENT_TERMINAL_STATES:
                    last_status["ownerToken"] = owner_token
                    return last_status, 2
                observation = last_status.get("observation")
                if session_id and isinstance(observation, dict):
                    last_status["ownerToken"] = owner_token
                    return last_status, 0
                time.sleep(args.poll_interval)
            raise CliError(
                "动态 Agent 会话未生成初始观察",
                124,
                sessionId=session_id,
                lastStatus=last_status,
            )
        except BaseException as exc:
            cleanup = best_effort_agent_cancel(adb, session_id, owner_token)
            if isinstance(exc, CliError):
                exc.details.setdefault("cleanup", cleanup)
            raise


def command_agent_observe(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    session_id = validate_agent_id(args.session_id, "sessionId")
    owner_token = validate_agent_owner_token(args.owner_token)
    with session_from_args(args, adb, preserve_foreground=True) as session:
        result = session.agent(
            "observe", {"sessionId": session_id, "ownerToken": owner_token}
        )
    return result, 0 if result.get("success") else 2


def agent_action_params(args: argparse.Namespace) -> Dict[str, str]:
    session_id = validate_agent_id(args.session_id, "sessionId")
    owner_token = validate_agent_owner_token(args.owner_token)
    step_id = validate_agent_id(args.step_id, "stepId")
    observation_id = validate_agent_id(args.observation_id, "observationId")
    action = args.action
    supplied = {
        "nodeId": args.node_id,
        "text": args.text,
        "direction": args.direction,
        "durationMs": args.duration_ms,
        "distance": args.distance,
    }
    allowed: Dict[str, set[str]] = {
        "click": {"nodeId"},
        "longClick": {"nodeId", "durationMs"},
        "input": {"nodeId", "text"},
        "back": set(),
        "home": set(),
        "scroll": {"nodeId", "direction", "distance"},
        "wait": {"durationMs"},
    }
    unexpected = [key for key, value in supplied.items() if value is not None and key not in allowed[action]]
    if unexpected:
        raise CliError(
            "动作 %s 不接受以下参数：%s" % (action, ", ".join(sorted(unexpected))),
            3,
        )
    if action in {"click", "longClick", "input"} and not args.node_id:
        raise CliError("动作 %s 需要 --node-id" % action, 3)
    if action == "input" and args.text is None:
        raise CliError("input 动作需要 --text", 3)
    if action == "scroll" and args.direction is None:
        raise CliError("scroll 动作需要 --direction", 3)
    if action == "wait" and args.duration_ms is None:
        raise CliError("wait 动作需要 --duration-ms", 3)
    if args.duration_ms is not None and not 100 <= args.duration_ms <= 5000:
        raise CliError("--duration-ms 必须在 100 到 5000 之间", 3)
    if args.distance is not None and not 1 <= args.distance <= 90:
        raise CliError("--distance 必须在 1 到 90 之间", 3)

    params = {
        "type": "act",
        "sessionId": session_id,
        "ownerToken": owner_token,
        "stepId": step_id,
        "observationId": observation_id,
        "action": action,
    }
    for key, value in supplied.items():
        if value is not None:
            params[key] = str(value)
    return params


def command_agent_act(
    args: argparse.Namespace,
    adb: AdbClient,
) -> tuple[Dict[str, Any], int]:
    params = agent_action_params(args)
    with session_from_args(args, adb, preserve_foreground=True) as session:
        try:
            invoke_agent_mutation(adb, params, timeout=args.action_timeout)
            deadline = time.monotonic() + args.action_timeout
            last_receipt: Optional[Dict[str, Any]] = None
            while time.monotonic() < deadline:
                last_receipt = session.agent(
                    "receipt",
                    {
                        "sessionId": params["sessionId"],
                        "ownerToken": params["ownerToken"],
                        "stepId": params["stepId"],
                    },
                    timeout=session.request_timeout,
                )
                if not last_receipt.get("success"):
                    if last_receipt.get("errorCode") == "receipt_not_found":
                        time.sleep(args.poll_interval)
                        continue
                    return last_receipt, 2
                receipt = last_receipt.get("receipt")
                if not isinstance(receipt, dict) or receipt.get("stepId") != params["stepId"]:
                    raise CliError("Agent 返回了其他步骤的回执", 4)
                status = receipt.get("status")
                if status in AGENT_RECEIPT_TERMINAL_STATES:
                    return last_receipt, 0 if status == "succeeded" else 2
                if status != "accepted":
                    raise CliError("Agent 返回了未知的回执状态", 4, receipt=receipt)
                time.sleep(args.poll_interval)
            raise CliError(
                "动态 Agent 动作超时",
                124,
                sessionId=params["sessionId"],
                stepId=params["stepId"],
                lastReceipt=last_receipt,
            )
        except BaseException as exc:
            cleanup = best_effort_agent_cancel(
                adb, params["sessionId"], params["ownerToken"]
            )
            if isinstance(exc, CliError):
                exc.details.setdefault("cleanup", cleanup)
            raise


def command_agent_query(
    args: argparse.Namespace,
    adb: AdbClient,
    query_type: str,
) -> tuple[Dict[str, Any], int]:
    params = {
        "sessionId": validate_agent_id(args.session_id, "sessionId"),
        "ownerToken": validate_agent_owner_token(args.owner_token),
    }
    with session_from_args(args, adb, preserve_foreground=True) as session:
        result = session.agent(query_type, params)
    return result, 0 if result.get("success") else 2


def command_agent_mutation(
    args: argparse.Namespace,
    adb: AdbClient,
    mutation_type: str,
) -> tuple[Dict[str, Any], int]:
    session_id = validate_agent_id(args.session_id, "sessionId")
    owner_token = validate_agent_owner_token(args.owner_token)
    params = {
        "type": mutation_type,
        "sessionId": session_id,
        "ownerToken": owner_token,
    }
    expected_states = {
        "pause": {"paused"},
        "resume": {"active"},
        "end": {"ended"},
        "cancel": {"cancelled"},
    }[mutation_type]
    with session_from_args(args, adb, preserve_foreground=True) as session:
        invoke_agent_mutation(adb, params, timeout=args.ack_timeout)
        deadline = time.monotonic() + args.ack_timeout
        last_status: Optional[Dict[str, Any]] = None
        while time.monotonic() < deadline:
            last_status = session.agent(
                "status",
                {"sessionId": session_id, "ownerToken": owner_token},
                timeout=session.request_timeout,
            )
            if not last_status.get("success"):
                return last_status, 2
            agent_session = last_status.get("session")
            if isinstance(agent_session, dict):
                state = agent_session.get("state")
                if state in expected_states:
                    return last_status, 0
                if state in AGENT_TERMINAL_STATES:
                    return last_status, 2
            time.sleep(args.poll_interval)
    raise CliError(
        "动态 Agent 操作 %s 未被确认" % mutation_type,
        124,
        sessionId=session_id,
        lastStatus=last_status,
    )


def command_screenshot(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    adb.connect()
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(adb.screenshot())
    return {"success": True, "screenshot": str(target.resolve())}, 0


def command_logs(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    adb.connect()
    target = Path(args.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(adb.logcat(), encoding="utf-8")
    return {"success": True, "logcat": str(target.resolve())}, 0


def verification_error(error: verification_engine.VerificationError) -> CliError:
    details = {"errorCode": error.code}
    details.update(error.details)
    return CliError(str(error), 3, **details)


def verification_call(operation: Callable[[], Any]) -> Any:
    try:
        return operation()
    except verification_engine.VerificationError as exc:
        raise verification_error(exc) from exc


def verification_file_evidence(path: Path, evidence_type: str) -> Dict[str, Any]:
    try:
        content = path.read_bytes()
    except OSError as exc:
        raise CliError(
            "无法读取验证证据",
            4,
            file=str(path),
            reason=str(exc),
        ) from exc
    return {
        "type": evidence_type,
        "path": str(path.resolve()),
        "sha256": hashlib.sha256(content).hexdigest(),
        "size": len(content),
    }


def sanitize_verification_evidence(value: Any, secret: Optional[str] = None) -> Any:
    if isinstance(value, dict):
        return {
            key: sanitize_verification_evidence(item, secret)
            for key, item in value.items()
            if key != "ownerToken"
        }
    if isinstance(value, list):
        return [sanitize_verification_evidence(item, secret) for item in value]
    if isinstance(value, str) and secret:
        return value.replace(secret, "[redacted]")
    return value


class VerificationEventWriter:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.sequence = 0
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event_type: str, **details: Any) -> None:
        self.sequence += 1
        event = {
            "sequence": self.sequence,
            "timestamp": int(time.time() * 1000),
            "type": event_type,
        }
        event.update(sanitize_verification_evidence(details))
        try:
            with self.path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
        except OSError as exc:
            raise CliError(
                "无法追加验证事件",
                4,
                file=str(self.path),
                reason=str(exc),
            ) from exc


def verification_nodes(observation: Any) -> Iterable[Dict[str, Any]]:
    if not isinstance(observation, dict):
        return
    page = observation.get("page")
    if not isinstance(page, dict):
        return
    stack = [page]
    while stack:
        node = stack.pop()
        yield node
        children = node.get("children", [])
        if isinstance(children, list):
            stack.extend(reversed([item for item in children if isinstance(item, dict)]))


def verification_target_node_id(action: Dict[str, Any], observation: Dict[str, Any]) -> Optional[str]:
    action_type = action.get("type")
    allowed_fields = {
        "click": {"type", "nodeId", "selector"},
        "longClick": {"type", "nodeId", "selector", "durationMs"},
        "input": {"type", "nodeId", "selector", "text"},
        "back": {"type"},
        "home": {"type"},
        "scroll": {"type", "nodeId", "selector", "direction", "distance"},
        "wait": {"type", "durationMs"},
    }.get(action_type)
    if allowed_fields is None:
        raise CliError("不支持该动态动作类型", 3, action=action_type)
    unknown = sorted(set(action) - allowed_fields)
    if unknown:
        raise CliError(
            "动态动作包含未知字段",
            3,
            action=action_type,
            fields=unknown,
        )
    if action_type not in {"click", "longClick", "input", "scroll"}:
        return None
    explicit_node_id = action.get("nodeId")
    selector = action.get("selector")
    if explicit_node_id is not None and selector is not None:
        raise CliError("动态动作不能同时包含 nodeId 和 selector", 3)
    nodes = list(verification_nodes(observation))
    if explicit_node_id is not None:
        if not isinstance(explicit_node_id, str) or not explicit_node_id:
            raise CliError("动态动作的 nodeId 不能为空", 3)
        if not any(item.get("nodeId") == explicit_node_id for item in nodes):
            raise CliError("当前观察中不存在动态动作指定的 nodeId", 3)
        return explicit_node_id
    if selector is None:
        if action_type == "scroll":
            return None
        raise CliError("动态节点动作需要 nodeId 或 selector", 3)
    if not isinstance(selector, dict) or not selector:
        raise CliError("动态动作的 selector 必须是非空对象", 3)
    unsupported = sorted(set(selector) - set(verification_engine.SELECTOR_FIELDS))
    if unsupported:
        raise CliError("动态动作的 selector 包含不支持的字段", 3, fields=unsupported)
    matching = [
        item
        for item in nodes
        if all(item.get(key) == expected for key, expected in selector.items())
    ]
    if len(matching) != 1 or not isinstance(matching[0].get("nodeId"), str):
        raise CliError(
            "动态动作的 selector 必须准确匹配一个当前节点",
            3,
            matchCount=len(matching),
        )
    return matching[0]["nodeId"]


def model_call(callback: Callable[[], Any]) -> Any:
    try:
        return callback()
    except model_deployment.ModelDeploymentError as exc:
        raise CliError(str(exc), 3, errorCode=exc.code, **exc.details) from exc


def parse_model_provider_response(output: str) -> Dict[str, Any]:
    normalized = output.strip()
    bundle_start = normalized.find("Bundle[")
    if bundle_start >= 0:
        normalized = normalized[bundle_start:]
    marker = "json="
    start = normalized.find(marker)
    if not normalized.startswith("Bundle[") or start < 0 or not normalized.endswith("}]"):
        raise model_deployment.ModelRuntimeError(
            "invalid_provider_response",
            "模型伴随服务返回的 Bundle 无效",
            fallback_eligible=True,
            output=normalized[:500],
        )
    raw_json = normalized[start + len(marker):-2]
    try:
        payload = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise model_deployment.ModelRuntimeError(
            "invalid_provider_response",
            "模型伴随服务返回的 JSON 无效",
            fallback_eligible=True,
            output=normalized[:500],
        ) from exc
    if not isinstance(payload, dict):
        raise model_deployment.ModelRuntimeError(
            "invalid_provider_response",
            "模型伴随服务响应必须是对象",
            fallback_eligible=True,
        )
    return payload


class AndroidExecuTorchRuntime(model_deployment.ModelRuntime):
    """受 DUMP 权限保护的 Android 伴随服务固定方法适配器。"""

    def __init__(self, adb: AdbClient, public_key: Path = DEFAULT_MODEL_PUBLIC_KEY) -> None:
        self.adb = adb
        self.public_key = Path(public_key)

    def _call(self, method: str, extras: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        allowed = {"health", "install", "status", "activate", "rollback", "infer", "benchmark"}
        if method not in allowed:
            raise model_deployment.ModelRuntimeError(
                "unsupported_operation", "不支持该模型伴随服务方法", fallback_eligible=False
            )
        command = ["content", "call", "--uri", MODEL_CONTROL_URI, "--method", method]
        for key, value in sorted((extras or {}).items()):
            if value is None:
                continue
            if isinstance(value, bool):
                binding_type = "b"
                encoded = str(value).lower()
            elif isinstance(value, int):
                binding_type = "i"
                encoded = str(value)
            elif isinstance(value, str):
                binding_type = "s"
                encoded = value
            else:
                raise model_deployment.ModelRuntimeError(
                    "invalid_argument",
                    "模型伴随服务的 extras 必须是标量",
                    fallback_eligible=False,
                )
            if "\x00" in encoded or len(encoded) > 128 * 1024:
                raise model_deployment.ModelRuntimeError(
                    "invalid_argument", "模型伴随服务 extra 参数不安全", fallback_eligible=False
                )
            command.extend(["--extra", "%s:%s:%s" % (key, binding_type, encoded)])
        result = self.adb.shell(command, timeout=180 if method in {"install", "benchmark"} else 60)
        if result.returncode != 0:
            raise model_deployment.ModelRuntimeError(
                "companion_unavailable",
                "模型伴随服务调用失败",
                fallback_eligible=True,
                stderr=result.stderr.strip(),
            )
        payload = parse_model_provider_response(result.stdout)
        if payload.get("success") is not True:
            code = payload.get("errorCode", "model_operation_failed")
            infrastructure = code in {
                "runtime_failure",
                "runtime_unavailable",
                "companion_unavailable",
                "model_not_active",
            }
            raise model_deployment.ModelRuntimeError(
                str(code),
                str(payload.get("error", "模型伴随服务拒绝了请求")),
                fallback_eligible=infrastructure,
            )
        return payload

    def _stage(self, token: str, local_path: Path, name: str) -> None:
        if name not in {"manifest.json", "manifest.sig", "model.pte"}:
            raise model_deployment.ModelRuntimeError(
                "unsafe_staging", "不支持该模型暂存文件", fallback_eligible=False
            )
        uri = "%s/%s/%s" % (MODEL_STAGING_URI, token, name)
        remote = ["content", "write", "--uri", uri]
        command = self.adb._base() + ["shell", shlex.join(remote)]
        result = self.adb.runner.run_file_input(command, Path(local_path), timeout=300)
        if result.returncode != 0:
            raise model_deployment.ModelRuntimeError(
                "staging_failed",
                "无法将模型包流式传输到伴随服务",
                fallback_eligible=True,
                file=name,
                stderr=result.stderr.strip(),
            )

    def _device_profile(self) -> model_deployment.DeviceProfile:
        health = self.health()
        return model_deployment.DeviceProfile(
            api_level=int(health["apiLevel"]),
            abi=str(health["abi"]),
            capabilities={"cpu"},
        )

    def health(self) -> Dict[str, Any]:
        if not self.adb.package_installed(MODEL_COMPANION_PACKAGE):
            raise model_deployment.ModelRuntimeError(
                "companion_unavailable",
                "未安装 SoloPi 模型伴随服务",
                fallback_eligible=True,
                package=MODEL_COMPANION_PACKAGE,
            )
        return self._call("health")

    def verify_package(self, package: Path) -> Dict[str, Any]:
        return model_deployment.verify_model_package(
            Path(package),
            {"solopi-poc-2026": self.public_key},
            self._device_profile(),
        )

    def install(self, package: Path) -> Dict[str, Any]:
        verified = self.verify_package(Path(package))
        token = uuid.uuid4().hex
        fully_staged = False
        try:
            self._stage(token, Path(verified["manifestPath"]), "manifest.json")
            self._stage(token, Path(verified["signaturePath"]), "manifest.sig")
            self._stage(token, Path(verified["artifactPath"]), "model.pte")
            fully_staged = True
            result = self._call("install", {"token": token})
        except BaseException:
            if not fully_staged:
                try:
                    self._call("install", {"token": token})
                except Exception:
                    pass
            raise
        result["packageDigest"] = verified["packageDigest"]
        return result

    def status(self, model_id: Optional[str] = None) -> Dict[str, Any]:
        return self._call("status", {"modelId": model_id})

    def activate(self, model_id: str, version: str) -> Dict[str, Any]:
        return self._call("activate", {"modelId": model_id, "version": version})

    def rollback(self, model_id: str) -> Dict[str, Any]:
        return self._call("rollback", {"modelId": model_id})

    def infer(
        self, model_id: str, version: Optional[str], inputs: Sequence[Sequence[float]]
    ) -> Dict[str, Any]:
        return self._call(
            "infer",
            {
                "modelId": model_id,
                "version": version,
                "inputsJson": json.dumps(inputs, separators=(",", ":")),
            },
        )

    def benchmark_device(
        self,
        model_id: str,
        version: Optional[str],
        inputs: Sequence[Sequence[float]],
        warmup: int,
        iterations: int,
    ) -> Dict[str, Any]:
        return self._call(
            "benchmark",
            {
                "modelId": model_id,
                "version": version,
                "inputsJson": json.dumps(inputs, separators=(",", ":")),
                "warmup": warmup,
                "iterations": iterations,
            },
        )


class SoloPiVerificationAdapter:
    def __init__(
        self,
        args: argparse.Namespace,
        adb: AdbClient,
        artifact_root: Path,
        event_path: Path,
        decision_provider: Optional[model_deployment.DecisionProvider] = None,
    ) -> None:
        self.args = args
        self.adb = adb
        self.artifact_root = artifact_root
        self.events = VerificationEventWriter(event_path)
        self._verification_secrets: set[str] = set()
        self.decision_provider = decision_provider

    def execute(
        self,
        segment: Dict[str, Any],
        scenario: Dict[str, Any],
        decisions: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        self.events.append(
            "segment_started",
            scenarioId=scenario["id"],
            segmentId=segment["segmentId"],
            phase=segment["phase"],
            route=segment["route"],
        )
        if segment["route"] == "deterministic":
            result = self._execute_fixed(segment, scenario)
        else:
            result = self._execute_dynamic(segment, scenario, decisions)
        self.events.append(
            "segment_finished",
            scenarioId=scenario["id"],
            segmentId=segment["segmentId"],
            phase=segment["phase"],
            route=segment["route"],
            state=result.get("state"),
            reason=result.get("reason"),
            agentDone=bool(result.get("agentDone")),
        )
        return result

    def _segment_root(self, segment: Dict[str, Any]) -> Path:
        target = self.artifact_root / "segments" / evidence_segment(segment["segmentId"])
        target.mkdir(parents=True, exist_ok=True)
        return target

    def _write_json_evidence(
        self,
        path: Path,
        payload: Any,
        evidence_type: str,
        secret: Optional[str] = None,
    ) -> Dict[str, Any]:
        sanitized = sanitize_verification_evidence(payload, secret)
        write_json_file(path, sanitized)
        return verification_file_evidence(path, evidence_type)

    def _redact_text_artifact(self, path: Path) -> None:
        try:
            content = path.read_bytes()
            redacted = content
            for secret in self._verification_secrets:
                redacted = redacted.replace(secret.encode("utf-8"), b"[redacted]")
            if redacted != content:
                path.write_bytes(redacted)
        except OSError as exc:
            raise CliError(
                "无法清理验证证据中的敏感信息",
                4,
                file=str(path),
                reason=str(exc),
            ) from exc

    def _execute_fixed(
        self, segment: Dict[str, Any], scenario: Dict[str, Any]
    ) -> Dict[str, Any]:
        segment_root = self._segment_root(segment)
        case_path = segment_root / "compiled-case.json"
        evidence = [
            self._write_json_evidence(
                case_path, segment["case"], "compiled_solopi_case"
            )
        ]
        import_args = copy.copy(self.args)
        import_args.file = str(case_path)
        import_args.replace = True
        import_args.confirm_high_risk = False
        import_args.import_timeout = self.args.import_timeout
        import_args.poll_interval = self.args.poll_interval
        import_result, import_exit = command_case_import(import_args, self.adb)
        evidence.append(
            self._write_json_evidence(
                segment_root / "import-receipt.json",
                import_result,
                "case_import_receipt",
            )
        )
        if import_exit != 0 or import_result.get("success") is not True:
            return {
                "state": "failed" if segment["phase"] == "cleanup" else "not_tested",
                "reason": "case_import_failed",
                "evidence": evidence,
            }

        run_args = copy.copy(self.args)
        run_args.case = segment["case"]["caseName"]
        run_args.target_package = scenario["targetAppPackage"]
        run_args.restart_app = self.args.restart_app if segment["phase"] != "cleanup" else False
        run_args.wait = True
        run_args.run_timeout = self.args.run_timeout
        run_args.ack_timeout = self.args.ack_timeout
        run_args.poll_interval = self.args.poll_interval
        run_args.artifacts = str(segment_root / "replay")
        run_args.no_auto_start = False
        run_args.confirm_high_risk = False
        run_result, run_exit = command_run(run_args, self.adb)
        evidence.append(
            self._write_json_evidence(
                segment_root / "run-response.json", run_result, "replay_result"
            )
        )
        artifacts = run_result.get("artifacts")
        if isinstance(artifacts, dict):
            for name, raw_path in sorted(artifacts.items()):
                path = Path(raw_path)
                if path.is_file():
                    if name == "logcat":
                        self._redact_text_artifact(path)
                    evidence.append(
                        verification_file_evidence(path, "replay_%s" % name)
                    )
        state = run_result.get("state")
        if state not in {"passed", "failed"}:
            state = "not_tested"
        result: Dict[str, Any] = {
            "state": state,
            "reason": None if state in {"passed", "failed"} else "replay_not_terminal",
            "run": sanitize_verification_evidence(run_result),
            "evidence": evidence,
        }
        failed_step_id = _verification_failed_step(run_result)
        if failed_step_id:
            result["failedStepId"] = failed_step_id
        if run_exit not in {0, 2} and state != "failed":
            result.update({"state": "not_tested", "reason": "replay_transport_failed"})
        return result

    def _execute_dynamic(
        self,
        segment: Dict[str, Any],
        scenario: Dict[str, Any],
        decisions: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        segment_root = self._segment_root(segment)
        dynamic_step = segment["dynamicStep"]
        if not decisions and self.decision_provider is None:
            payload = {
                "scenarioId": scenario["id"],
                "stepId": dynamic_step["id"],
                "state": "not_tested",
                "reason": "checkpoint_not_reached",
                "decisions": [],
            }
            return {
                "state": "not_tested",
                "reason": "checkpoint_not_reached",
                "evidence": [
                    self._write_json_evidence(
                        segment_root / "agent-transcript.json", payload, "agent_transcript"
                    )
                ],
            }
        if not all(isinstance(item, dict) for item in decisions):
            raise CliError("Agent 决策必须由对象组成", 3)
        first_type = decisions[0].get("type") if decisions else None
        if first_type == "blocked" and self.decision_provider is None:
            reason = decisions[0].get("reason", "checkpoint_not_reached")
            if not isinstance(reason, str) or not reason:
                raise CliError("blocked Agent 决策必须提供原因", 3)
            payload = {
                "scenarioId": scenario["id"],
                "stepId": dynamic_step["id"],
                "state": "not_tested",
                "reason": reason,
                "decisions": sanitize_verification_evidence(decisions),
            }
            return {
                "state": "not_tested",
                "reason": "checkpoint_not_reached",
                "evidence": [
                    self._write_json_evidence(
                        segment_root / "agent-transcript.json", payload, "agent_transcript"
                    )
                ],
            }

        owner_token = "verification-%s" % uuid.uuid4().hex
        self._verification_secrets.add(owner_token)
        session_id: Optional[str] = None
        observation: Optional[Dict[str, Any]] = None
        transcript: Dict[str, Any] = {
            "scenarioId": scenario["id"],
            "stepId": dynamic_step["id"],
            "goal": dynamic_step["goal"],
            "allowedActions": dynamic_step["allowedActions"],
            "events": [],
        }
        evidence: List[Dict[str, Any]] = []
        final_state = "not_tested"
        final_reason: Optional[str] = "checkpoint_not_reached"
        agent_done = False
        terminal_command = "cancel"
        start_args = copy.copy(self.args)
        start_args.owner_token = owner_token
        for key, value in dynamic_step["budget"].items():
            setattr(
                start_args,
                {
                    "maxSteps": "max_steps",
                    "maxDurationMs": "max_duration_ms",
                    "idleTimeoutMs": "idle_timeout_ms",
                    "maxRepeatedActions": "max_repeated_actions",
                    "maxNoProgressSteps": "max_no_progress_steps",
                }[key],
                value,
            )
        start_args.ack_timeout = self.args.agent_start_timeout
        start_args.poll_interval = self.args.poll_interval
        try:
            try:
                target_component = self.adb.resolve_launcher_component(
                    scenario["targetAppPackage"]
                )
                target_restored = self.adb.restore_foreground(target_component)
            except CliError as exc:
                target_restored = False
                transcript["events"].append(
                    {"type": "target_app_restore_failed", "error": str(exc)}
                )
            if not target_restored:
                if not transcript["events"]:
                    transcript["events"].append(
                        {"type": "target_app_restore_failed"}
                    )
                final_reason = "target_app_restore_failed"
                return {
                    "state": final_state,
                    "reason": final_reason,
                    "agentDone": agent_done,
                    "observation": None,
                    "evidence": evidence,
                }
            transcript["events"].append({"type": "target_app_restored"})
            started, start_exit = command_agent_session_start(start_args, self.adb)
            session = started.get("session")
            if start_exit != 0 or not isinstance(session, dict):
                transcript["events"].append(
                    {"type": "start_failed", "result": sanitize_verification_evidence(started, owner_token)}
                )
                final_reason = "agent_start_failed"
                return {
                    "state": final_state,
                    "reason": final_reason,
                    "agentDone": agent_done,
                    "observation": None,
                    "evidence": evidence,
                }
            session_id = session.get("sessionId")
            observation = started.get("observation")
            if not isinstance(session_id, str) or not isinstance(observation, dict):
                final_reason = "agent_start_contract_invalid"
                return {
                    "state": final_state,
                    "reason": final_reason,
                    "agentDone": agent_done,
                    "observation": sanitize_verification_evidence(observation),
                    "evidence": evidence,
                }
            transcript["sessionId"] = session_id
            transcript["events"].append(
                {
                    "type": "started",
                    "observation": sanitize_verification_evidence(observation),
                }
            )
            max_decisions = int(dynamic_step["budget"]["maxSteps"]) + 1
            for index in range(max_decisions):
                if self.decision_provider is not None:
                    decision = self.decision_provider.decide(
                        {
                            "scenarioId": scenario["id"],
                            "segmentId": segment["segmentId"],
                            "stepId": dynamic_step["id"],
                            "stepIndex": index,
                            "goal": dynamic_step["goal"],
                            "allowedActions": dynamic_step["allowedActions"],
                            "observation": sanitize_verification_evidence(observation),
                        }
                    )
                    if not isinstance(decision, dict):
                        raise CliError("DecisionProvider 必须返回对象", 3)
                else:
                    if index >= len(decisions):
                        break
                    decision = decisions[index]
                decision_type = decision.get("type")
                if decision_type == "done":
                    unknown = sorted(set(decision) - {"type", "reason", "modelReceipt", "fallback"})
                    if unknown:
                        raise CliError("Agent done 决策包含未知字段", 3, fields=unknown)
                    agent_done = True
                    final_state = "done"
                    final_reason = None
                    terminal_command = "end"
                    transcript["events"].append({
                        "type": "done",
                        "reason": decision.get("reason"),
                        "decision": sanitize_verification_evidence(decision),
                    })
                    break
                if decision_type == "blocked":
                    final_reason = "checkpoint_not_reached"
                    transcript["events"].append({
                        "type": "blocked",
                        "reason": decision.get("reason"),
                        "decision": sanitize_verification_evidence(decision),
                    })
                    break
                if decision_type != "act":
                    raise CliError("Agent 决策类型必须是 act、done 或 blocked", 3)
                unknown = sorted(
                    set(decision) - {"type", "stepId", "action", "modelReceipt", "fallback"}
                )
                if unknown:
                    raise CliError("Agent act 决策包含未知字段", 3, fields=unknown)
                action = decision.get("action")
                if not isinstance(action, dict):
                    raise CliError("Agent act 决策需要类型化动作对象", 3)
                action_type = action.get("type")
                if action_type not in dynamic_step["allowedActions"] or action_type not in AGENT_ACTIONS:
                    raise CliError(
                        "Agent 动作不在已编译白名单内",
                        3,
                        action=action_type,
                    )
                if not isinstance(observation, dict):
                    final_reason = "missing_observation"
                    break
                act_args = copy.copy(self.args)
                act_args.session_id = session_id
                act_args.owner_token = owner_token
                act_args.step_id = decision.get(
                    "stepId", "%s-%03d" % (dynamic_step["id"], index + 1)
                )
                act_args.observation_id = observation.get("observationId")
                act_args.action = action_type
                act_args.node_id = verification_target_node_id(action, observation)
                act_args.text = action.get("text")
                act_args.direction = action.get("direction")
                act_args.duration_ms = action.get("durationMs")
                act_args.distance = action.get("distance")
                act_args.action_timeout = self.args.agent_action_timeout
                act_args.poll_interval = self.args.poll_interval
                acted, act_exit = command_agent_act(act_args, self.adb)
                transcript["events"].append(
                    {
                        "type": "act",
                        "decision": sanitize_verification_evidence(decision),
                        "result": sanitize_verification_evidence(acted, owner_token),
                    }
                )
                receipt = acted.get("receipt")
                if act_exit != 0 or not isinstance(receipt, dict) or receipt.get("status") != "succeeded":
                    final_reason = "agent_action_failed"
                    break
                settled = receipt.get("settledObservation")
                if not isinstance(settled, dict):
                    final_reason = "agent_settle_missing"
                    break
                observation = settled
            query_args = copy.copy(self.args)
            query_args.session_id = session_id
            query_args.owner_token = owner_token
            timeline, _ = command_agent_query(query_args, self.adb, "timeline")
            evidence.append(
                self._write_json_evidence(
                    segment_root / "agent-timeline.json",
                    timeline,
                    "agent_timeline",
                    owner_token,
                )
            )
        except (CliError, model_deployment.ModelDeploymentError, KeyboardInterrupt) as exc:
            event = {"type": "error", "error": str(exc)}
            if isinstance(exc, model_deployment.ModelDeploymentError):
                event["errorCode"] = exc.code
                final_reason = "model_decision_failed"
            else:
                final_reason = "agent_execution_failed"
            transcript["events"].append(event)
            if isinstance(exc, KeyboardInterrupt):
                raise
        finally:
            if session_id:
                mutation_args = copy.copy(self.args)
                mutation_args.session_id = session_id
                mutation_args.owner_token = owner_token
                mutation_args.ack_timeout = self.args.agent_end_timeout
                mutation_args.poll_interval = self.args.poll_interval
                try:
                    ended, _ = command_agent_mutation(
                        mutation_args, self.adb, terminal_command
                    )
                    transcript["events"].append(
                        {
                            "type": terminal_command,
                            "result": sanitize_verification_evidence(ended, owner_token),
                        }
                    )
                except Exception as exc:
                    transcript["events"].append(
                        {"type": "cleanup_error", "error": str(exc)}
                    )
                    final_state = "not_tested"
                    final_reason = "agent_cleanup_failed"
            evidence.append(
                self._write_json_evidence(
                    segment_root / "agent-transcript.json",
                    transcript,
                    "agent_transcript",
                    owner_token,
                )
            )
        return {
            "state": final_state,
            "reason": final_reason,
            "agentDone": agent_done,
            "observation": sanitize_verification_evidence(observation),
            "evidence": evidence,
        }


def _verification_failed_step(run_result: Dict[str, Any]) -> Optional[str]:
    results = run_result.get("results")
    if not isinstance(results, list):
        return None
    for result in results:
        if isinstance(result, dict):
            step_id = result.get("exceptionStepId")
            if isinstance(step_id, str) and step_id:
                return step_id
    return None


def command_verify_normalize(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    normalized = verification_call(
        lambda: verification_engine.normalize_requirement(load_json_file(Path(args.file)))
    )
    result = copy.deepcopy(normalized)
    if args.output:
        result["output"] = write_json_file(Path(args.output), normalized)
    return result, 0


def command_verify_compile(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    plan = verification_call(
        lambda: verification_engine.compile_verification_plan(
            load_json_file(Path(args.file))
        )
    )
    output = write_json_file(Path(args.output), plan)
    case_paths: List[str] = []
    seen_cases = set()
    if args.cases_dir:
        case_root = Path(args.cases_dir)
        for scenario in plan["intent"]["scenarios"]:
            for segment in scenario["segments"]:
                case_payload = segment.get("case")
                if not isinstance(case_payload, dict):
                    continue
                case_name = case_payload["caseName"]
                if case_name in seen_cases:
                    continue
                seen_cases.add(case_name)
                case_paths.append(
                    write_json_file(case_root / (case_name + ".json"), case_payload)
                )
    case_count = sum(
        1
        for scenario in plan["intent"]["scenarios"]
        for segment in scenario["segments"]
        if isinstance(segment.get("case"), dict)
    )
    return {
        "success": True,
        "planFingerprint": plan["planFingerprint"],
        "scenarioCount": len(plan["intent"]["scenarios"]),
        "caseCount": case_count,
        "output": output,
        "cases": case_paths,
    }, 0


def command_verify_validate(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    result = verification_call(
        lambda: verification_engine.validate_verification_plan(
            load_json_file(Path(args.plan))
        )
    )
    return {"success": True, **result}, 0


def model_runtime_from_args(args: argparse.Namespace, adb: AdbClient) -> AndroidExecuTorchRuntime:
    public_key = Path(getattr(args, "public_key", None) or DEFAULT_MODEL_PUBLIC_KEY)
    return AndroidExecuTorchRuntime(adb, public_key)


def model_inputs_from_args(args: argparse.Namespace) -> List[List[float]]:
    if getattr(args, "inputs_file", None):
        raw = load_json_file(Path(args.inputs_file))
    else:
        try:
            raw = json.loads(args.inputs)
        except json.JSONDecodeError as exc:
            raise CliError("--inputs 必须是有效 JSON", 3) from exc
    if not isinstance(raw, list) or not raw or not all(isinstance(item, list) and item for item in raw):
        raise CliError("模型输入必须是由非空张量组成的非空数组", 3)
    normalized: List[List[float]] = []
    for tensor in raw:
        values = []
        for value in tensor:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise CliError("模型张量值必须是数字", 3)
            number = float(value)
            if not math.isfinite(number):
                raise CliError("模型张量值必须是有限数字", 3)
            values.append(number)
        normalized.append(values)
    return normalized


def command_model_verify(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    profile = None
    if args.api_level is not None or args.abi is not None:
        if args.api_level is None or args.abi is None:
            raise CliError("--api-level 和 --abi 必须同时提供", 3)
        profile = model_deployment.DeviceProfile(args.api_level, args.abi, {"cpu"})
    result = model_call(
        lambda: model_deployment.verify_model_package(
            Path(args.package),
            {"solopi-poc-2026": Path(args.public_key)},
            profile,
        )
    )
    return result, 0


def command_model_health(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    return model_call(lambda: model_runtime_from_args(args, adb).health()), 0


def command_model_install(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    return model_call(lambda: model_runtime_from_args(args, adb).install(Path(args.package))), 0


def command_model_status(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    return model_call(lambda: model_runtime_from_args(args, adb).status(args.model_id)), 0


def command_model_activate(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    return model_call(
        lambda: model_runtime_from_args(args, adb).activate(args.model_id, args.model_version)
    ), 0


def command_model_rollback(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    return model_call(lambda: model_runtime_from_args(args, adb).rollback(args.model_id)), 0


def command_model_infer(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    inputs = model_inputs_from_args(args)
    return model_call(
        lambda: model_runtime_from_args(args, adb).infer(
            args.model_id, args.model_version, inputs
        )
    ), 0


def command_model_benchmark(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    inputs = model_inputs_from_args(args)
    runtime = model_runtime_from_args(args, adb)
    verified = model_call(lambda: runtime.verify_package(Path(args.package)))
    manifest = verified["manifest"]
    if args.model_id != manifest["modelId"]:
        raise CliError("--model-id 与签名清单不匹配", 3)
    if args.model_version and args.model_version != manifest["version"]:
        raise CliError("--model-version 与签名清单不匹配", 3)
    health = model_call(runtime.health)
    expected_runtime = manifest["runtime"]
    backends = health.get("backends")
    if (
        health.get("runtime") != expected_runtime["name"]
        or health.get("runtimeVersion") != expected_runtime["version"]
        or not isinstance(backends, list)
        or expected_runtime["backend"] not in backends
    ):
        raise CliError("模型伴随运行时与签名清单不匹配", 3)
    result = model_call(
        lambda: runtime.benchmark_device(
            manifest["modelId"],
            manifest["version"],
            inputs,
            args.warmup,
            args.iterations,
        )
    )
    for field, expected in {
        "modelId": manifest["modelId"],
        "version": manifest["version"],
        "backend": expected_runtime["backend"],
    }.items():
        if result.get(field) != expected:
            raise CliError(
                "模型基准测试回执与签名清单不匹配",
                3,
                field=field,
                expected=expected,
                actual=result.get(field),
            )
    result.update(
        {
            "schemaVersion": model_deployment.BENCHMARK_SCHEMA,
            "runtime": expected_runtime["name"],
            "runtimeVersion": expected_runtime["version"],
            "packageDigest": verified["packageDigest"],
            "deviceProfile": verified["deviceProfile"],
        }
    )
    if args.output:
        result["output"] = write_json_file(Path(args.output), result)
    return result, 0


def command_model_release_check(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    verified = model_call(
        lambda: model_deployment.verify_model_package(
            Path(args.package),
            {"solopi-poc-2026": Path(args.public_key)},
        )
    )
    benchmark = load_json_file(Path(args.benchmark))
    evaluation = load_json_file(Path(args.evaluation))
    if not isinstance(benchmark, dict) or not isinstance(evaluation, dict):
        raise CliError("基准测试和评估报告必须是对象", 3)
    evidence = model_call(
        lambda: model_deployment.validate_release_evidence(
            verified["manifest"], verified["packageDigest"], benchmark, evaluation
        )
    )
    result = model_call(
        lambda: model_deployment.evaluate_release_gates(
            verified["manifest"], evidence["metrics"]
        )
    )
    result["packageDigest"] = verified["packageDigest"]
    result["evidence"] = {
        "deviceProfile": evidence["deviceProfile"],
        "providers": evidence["providers"],
        "testSetDigest": evidence["testSetDigest"],
    }
    if args.output:
        result["output"] = write_json_file(Path(args.output), result)
    return result, 0 if result["status"] == "approved" else 2


def decision_provider_from_args(
    args: argparse.Namespace, adb: AdbClient
) -> Optional[model_deployment.DecisionProvider]:
    provider_type = getattr(args, "decision_provider", "static")
    if provider_type == "static":
        return None
    if getattr(args, "agent_decisions", None):
        raise CliError("实时 DecisionProvider 不能与 --agent-decisions 同时使用", 3)
    if provider_type == "cloud":
        endpoint = getattr(args, "cloud_endpoint", None)
        if not endpoint:
            raise CliError("云端 DecisionProvider 需要 --cloud-endpoint", 3)
        return model_deployment.CloudDecisionProvider(endpoint=endpoint)
    package = getattr(args, "model_package", None)
    if not package:
            raise CliError("端侧 DecisionProvider 需要 --model-package", 3)
    runtime = model_runtime_from_args(args, adb)
    verified = model_call(lambda: runtime.verify_package(Path(package)))
    manifest = verified["manifest"]
    requested_model = getattr(args, "model_id", None)
    requested_version = getattr(args, "model_version", None)
    if requested_model and requested_model != manifest["modelId"]:
        raise CliError("--model-id 与签名清单不匹配", 3)
    if requested_version and requested_version != manifest["version"]:
        raise CliError("--model-version 与签名清单不匹配", 3)
    provider: model_deployment.DecisionProvider = model_deployment.OnDeviceDecisionProvider(
        runtime,
        manifest["modelId"],
        manifest["version"],
        manifest["contract"],
    )
    fallback_endpoint = getattr(args, "cloud_fallback_endpoint", None)
    if fallback_endpoint:
        provider = model_deployment.FallbackDecisionProvider(
            provider, model_deployment.CloudDecisionProvider(endpoint=fallback_endpoint)
        )
    return provider


def command_verify_run(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    plan = load_json_file(Path(args.plan))
    verification_call(lambda: verification_engine.validate_verification_plan(plan))
    decisions = (
        load_json_file(Path(args.agent_decisions)) if args.agent_decisions else {}
    )
    if not isinstance(decisions, dict):
        raise CliError("Agent 决策文件必须包含对象", 3)
    artifact_root = Path(args.artifacts)
    if artifact_root.exists():
        raise CliError(
            "验证证据目录已存在",
            3,
            artifacts=str(artifact_root),
        )
    artifact_root.mkdir(parents=True)
    plan_copy = artifact_root / "plan.json"
    write_json_file(plan_copy, plan)
    events_path = artifact_root / "events.jsonl"
    decision_provider = decision_provider_from_args(args, adb)
    adapter = SoloPiVerificationAdapter(
        args, adb, artifact_root, events_path, decision_provider=decision_provider
    )
    adapter.events.append(
        "verification_started",
        requirementId=plan["intent"]["requirement"]["id"],
        planFingerprint=plan["planFingerprint"],
    )
    report = verification_call(
        lambda: verification_engine.execute_verification_plan(
            plan, adapter, decisions
        )
    )
    adapter.events.append(
        "verification_finished",
        reportId=report["reportId"],
        status=report["status"],
        outcomeFingerprint=report["outcomeFingerprint"],
    )
    report["artifacts"] = {
        "plan": str(plan_copy.resolve()),
        "events": str(events_path.resolve()),
    }
    report_path = artifact_root / "report.json"
    write_json_file(report_path, report)
    payload = {
        "success": report["status"] == "passed",
        "status": report["status"],
        "reportId": report["reportId"],
        "planFingerprint": report["planFingerprint"],
        "outcomeFingerprint": report["outcomeFingerprint"],
        "report": str(report_path.resolve()),
        "events": str(events_path.resolve()),
    }
    return payload, 0 if payload["success"] else 2


def managed_call(callback: Callable[[], Any]) -> Any:
    try:
        return callback()
    except managed_execution.ManagedExecutionError as exc:
        raise CliError(str(exc), 3, errorCode=exc.code, **exc.details) from exc


def managed_store(args: argparse.Namespace) -> managed_execution.ManagedExecutionStore:
    return managed_call(lambda: managed_execution.ManagedExecutionStore(Path(args.database)))


def parse_cli_labels(values: Sequence[str]) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for raw in values:
        if "=" not in raw:
            raise CliError("设备标签必须使用 key=value 语法", 3, label=raw)
        key, value = raw.split("=", 1)
        if not key or not value or key in result:
            raise CliError("设备标签为空或重复", 3, label=raw)
        result[key] = value
    return result


def command_managed_health(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    result = managed_store(args).health_summary()
    return {"success": True, **result}, 0


def command_managed_device_register(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    result = managed_call(
        lambda: managed_store(args).register_device(
            args.device_id,
            args.device_serial,
            "android",
            args.api_level,
            args.capability,
            parse_cli_labels(args.label),
            args.health,
        )
    )
    return {"success": True, "device": result}, 0


def command_managed_device_probe(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    device = adb.connect()
    sdk_result = adb.shell(["getprop", "ro.build.version.sdk"], timeout=10)
    try:
        api_level = int(sdk_result.stdout.strip())
    except ValueError as exc:
        raise CliError(
            "无法检测 Android API 级别", 4, stderr=sdk_result.stderr.strip()
        ) from exc
    doctor, doctor_exit = command_doctor(args, adb)
    capabilities = {"adb"}
    if doctor.get("installed") is True:
        capabilities.add("verification")
    if doctor_exit == 0:
        capabilities.update({"agent", "managed-worker"})
    capabilities.update(args.capability)
    health = "healthy" if doctor_exit == 0 else "degraded"
    device_id = args.device_id or re.sub(r"[^A-Za-z0-9._:-]", "-", device["serial"])
    result = managed_call(
        lambda: managed_store(args).register_device(
            device_id,
            device["serial"],
            "android",
            api_level,
            sorted(capabilities),
            parse_cli_labels(args.label),
            health,
        )
    )
    return {
        "success": doctor_exit == 0,
        "device": result,
        "doctor": doctor,
    }, doctor_exit


def command_managed_device_list(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    devices = managed_store(args).list_devices()
    return {"success": True, "count": len(devices), "devices": devices}, 0


def command_managed_submit(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    plan = load_json_file(Path(args.plan))
    verification_call(lambda: verification_engine.validate_verification_plan(plan))
    matrix = load_json_file(Path(args.matrix))
    decisions = (
        load_json_file(Path(args.agent_decisions)) if args.agent_decisions else {}
    )
    result = managed_call(
        lambda: managed_store(args).submit_task(
            plan=plan,
            matrix=matrix,
            idempotency_key=args.idempotency_key,
            owner_token=args.owner_token,
            decisions=decisions,
            max_retries=args.max_retries,
            lease_duration_ms=args.lease_duration_ms,
            retention_ms=args.retention_ms,
        )
    )
    return {"success": True, **result}, 0


def command_managed_status(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    result = managed_call(lambda: managed_store(args).task_status(args.task_id))
    return {"success": True, **result}, 0


def command_managed_events(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    events = managed_call(
        lambda: managed_store(args).task_events(args.task_id, args.after_sequence)
    )
    return {"success": True, "taskId": args.task_id, "events": events}, 0


def command_managed_report(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    report = managed_call(lambda: managed_store(args).task_report(args.task_id))
    if args.output:
        write_json_file(Path(args.output), report)
    payload = {"success": report["status"] == "passed", **report}
    if args.output:
        payload["output"] = str(Path(args.output).expanduser().resolve())
    return payload, report["exitCode"]


def command_managed_cancel(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    result = managed_call(
        lambda: managed_store(args).cancel_task(args.task_id, args.owner_token)
    )
    return {"success": True, **result}, 0


def command_managed_recover(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    result = managed_store(args).recover_expired()
    return {"success": True, **result}, 0


def evidence_directory_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as stream:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def _managed_verification_args(
    args: argparse.Namespace,
    plan_path: Path,
    decisions_path: Optional[Path],
    artifact_root: Path,
) -> argparse.Namespace:
    values = vars(args).copy()
    values.update(
        {
            "command": "verify-run",
            "plan": str(plan_path),
            "agent_decisions": str(decisions_path) if decisions_path else None,
            "artifacts": str(artifact_root),
        }
    )
    return argparse.Namespace(**values)


def run_managed_assignment(
    args: argparse.Namespace,
    assignment: Dict[str, Any],
    store: managed_execution.ManagedExecutionStore,
) -> tuple[Dict[str, Any], int]:
    store.start_attempt(assignment)
    stop_heartbeat = threading.Event()
    lease_lost: List[managed_execution.ManagedExecutionError] = []

    def heartbeat_loop() -> None:
        interval = max(0.2, assignment["leaseDurationMs"] / 3000.0)
        while not stop_heartbeat.wait(interval):
            try:
                store.heartbeat(assignment)
            except managed_execution.ManagedExecutionError as exc:
                lease_lost.append(exc)
                return

    heartbeat = threading.Thread(
        target=heartbeat_loop,
        name="solopi-managed-heartbeat-%s" % assignment["attemptId"],
        daemon=True,
    )
    heartbeat.start()
    artifact_root = (
        Path(args.artifacts_root)
        / assignment["taskId"]
        / assignment["shardId"]
        / assignment["attemptId"]
    ).expanduser().resolve()
    try:
        with tempfile.TemporaryDirectory(prefix="solopi-managed-input-") as directory:
            plan_path = Path(directory) / "plan.json"
            decisions_path = Path(directory) / "decisions.json"
            write_json_file(plan_path, assignment["plan"])
            decisions: Optional[Path] = None
            if assignment["decisions"]:
                write_json_file(decisions_path, assignment["decisions"])
                decisions = decisions_path
            worker_adb = AdbClient(
                args.adb,
                assignment["serial"],
                control_package=args.package,
            )
            payload, _ = command_verify_run(
                _managed_verification_args(args, plan_path, decisions, artifact_root),
                worker_adb,
            )
        stop_heartbeat.set()
        heartbeat.join(timeout=2)
        if lease_lost:
            raise lease_lost[0]
        report = load_json_file(Path(payload["report"]))
        status = report.get("status")
        if status not in managed_execution.RESULT_STATUSES:
            raise CliError("验证返回了不支持的托管状态", 4)
        failure_category = None
        if status != "passed":
            categories = sorted(
                {
                    str(item.get("failureCategory"))
                    for item in report.get("scenarios", [])
                    if isinstance(item, dict) and item.get("failureCategory")
                }
            )
            failure_category = categories[0] if categories else "verification_%s" % status
        receipt = store.complete_assignment(
            assignment,
            status,
            report=report,
            report_path=payload["report"],
            evidence_digest=evidence_directory_digest(artifact_root),
            failure_category=failure_category,
        )
        return {
            "success": status == "passed",
            "assignment": assignment,
            "result": receipt,
            "report": payload["report"],
        }, 0 if status == "passed" else 2
    except managed_execution.ManagedExecutionError as exc:
        raise CliError(str(exc), 4, errorCode=exc.code, **exc.details) from exc
    except (CliError, OSError) as exc:
        stop_heartbeat.set()
        heartbeat.join(timeout=2)
        category = "transport_error" if isinstance(exc, OSError) or getattr(exc, "exit_code", 3) == 4 else "worker_error"
        try:
            failure = store.fail_assignment(
                assignment, category, retryable=category == "transport_error"
            )
        except managed_execution.ManagedExecutionError as stale:
            raise CliError(str(stale), 4, errorCode=stale.code, **stale.details) from exc
        if isinstance(exc, CliError):
            details = exc.details.copy()
            details["assignmentFailure"] = failure
            raise CliError(str(exc), exc.exit_code, **details) from exc
        raise CliError(str(exc), 4, assignmentFailure=failure) from exc
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=2)


def command_managed_worker_once(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    store = managed_store(args)
    assignment = managed_call(lambda: store.claim_next(args.worker_id))
    if assignment is None:
        return {"success": True, "claimed": False}, 0
    payload, exit_code = run_managed_assignment(args, assignment, store)
    payload["claimed"] = True
    return payload, exit_code


def command_managed_worker_loop(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    store = managed_store(args)
    processed = 0
    idle_polls = 0
    failures = 0
    while args.max_assignments == 0 or processed < args.max_assignments:
        assignment = managed_call(lambda: store.claim_next(args.worker_id))
        if assignment is None:
            idle_polls += 1
            if args.max_idle_polls and idle_polls >= args.max_idle_polls:
                break
            time.sleep(args.idle_interval)
            continue
        idle_polls = 0
        try:
            _, exit_code = run_managed_assignment(args, assignment, store)
            failures += int(exit_code != 0)
        except CliError:
            failures += 1
        processed += 1
    return {
        "success": failures == 0,
        "processed": processed,
        "failures": failures,
        "idlePolls": idle_polls,
    }, 0 if failures == 0 else 2


def command_managed_serve(
    args: argparse.Namespace, adb: AdbClient
) -> tuple[Dict[str, Any], int]:
    del adb
    server = managed_call(
        lambda: managed_execution.create_http_server(
            managed_store(args), args.bearer_token, args.bind, args.port
        )
    )
    host, port = server.server_address[:2]
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
    return {"success": True, "stopped": True, "bind": host, "port": port}, 0


def build_parser() -> argparse.ArgumentParser:
    parser = ChineseArgumentParser(prog="solopi-ai", description=__doc__)
    parser.add_argument("--adb", default=os.environ.get("ADB", "adb"), help="ADB 可执行文件路径")
    parser.add_argument("--serial", help="ADB 设备序列号；连接多台设备时必须指定")
    parser.add_argument("--package", default=DEFAULT_PACKAGE, help="SoloPi 应用包名")
    parser.add_argument("--device-port", type=int, default=DEFAULT_DEVICE_PORT, help="设备控制服务端口")
    parser.add_argument("--local-port", type=int, default=0, help="本地转发端口；0 表示自动分配")
    parser.add_argument("--request-timeout", type=positive_float, default=5, help="单次控制请求超时秒数")
    parser.add_argument("--startup-timeout", type=positive_float, default=15, help="控制服务启动超时秒数")
    parser.add_argument("--pretty", action="store_true", help="缩进输出 JSON")

    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("doctor", help="检查设备、应用、权限和协议")
    adb_connect_parser = subparsers.add_parser(
        "adb-connect", help="初始化 SoloPi 内部 ADB 连接并重新核对 doctor"
    )
    adb_connect_parser.add_argument(
        "--connect-timeout", type=positive_float, default=20,
        help="等待内部 ADB 连接终态的超时秒数",
    )
    adb_connect_parser.add_argument(
        "--ready-timeout", type=positive_float, default=5,
        help="连接成功后等待 doctor 就绪的超时秒数",
    )
    adb_connect_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.25,
        help="连接状态与 doctor 轮询间隔秒数",
    )
    subparsers.add_parser("capabilities", help="输出机器可读的能力契约")
    subparsers.add_parser("cases", help="列出 SoloPi 已录制用例")
    subparsers.add_parser("apps", help="列出 SoloPi 可选目标应用")
    subparsers.add_parser("app-info", help="查询 SoloPi、设备、协议和许可证信息")
    subparsers.add_parser("actions", help="列出枚举动作和动态 Provider 动作")
    subparsers.add_parser("status", help="查询最近一次回放状态和结果摘要")
    subparsers.add_parser("app-status", help="查询 SoloPi 通用运行状态")
    subparsers.add_parser("inspect", help="导出当前辅助功能页面树")

    subparsers.add_parser("config-list", help="列出 SoloPi 类型化配置项")
    config_get_parser = subparsers.add_parser(
        "config-get", help="读取一个 SoloPi 类型化配置项"
    )
    config_get_parser.add_argument("--key", required=True, help="配置键")
    config_set_parser = subparsers.add_parser(
        "config-set", help="修改一个可写配置项并校验最终值"
    )
    config_set_parser.add_argument("--key", required=True, help="配置键")
    config_set_parser.add_argument("--value", required=True, help="待写入的字符串值")
    config_set_parser.add_argument("--ack-timeout", type=positive_float, default=15, help="写入确认超时秒数")
    config_set_parser.add_argument("--poll-interval", type=positive_float, default=0.2, help="状态轮询间隔秒数")

    result_parser = subparsers.add_parser("result", help="查询最近一次终态回放结果")
    result_parser.add_argument("--run-id", help="仅接受匹配该 runId 的结果")

    case_get_parser = subparsers.add_parser(
        "case-get", help="导出包含完整步骤的已录制用例"
    )
    case_get_parser.add_argument("--case", required=True, help="用例名称")
    case_get_parser.add_argument("--output", help="适合编辑的用例 JSON 输出文件")

    case_template_parser = subparsers.add_parser(
        "case-template", help="创建适合编辑的 SoloPi 用例模板"
    )
    case_template_parser.add_argument("--name", required=True, help="用例名称")
    case_template_parser.add_argument("--target-package", required=True, help="目标应用包名")
    case_template_parser.add_argument("--target-label", help="目标应用显示名称")
    case_template_parser.add_argument("--output", help="模板输出文件")

    def add_high_risk_confirmation(command_parser: argparse.ArgumentParser) -> None:
        command_parser.add_argument(
            "--confirm-high-risk",
            action="store_true",
            help="确认 CLEAR_DATA、KILL_PROCESS 或 JUMP_TO_PAGE 的影响范围",
        )

    case_validate_parser = subparsers.add_parser(
        "case-validate", help="校验并规范化 SoloPi 用例 JSON"
    )
    case_validate_parser.add_argument("--file", required=True, help="待校验的用例 JSON 文件")
    case_validate_parser.add_argument("--output", help="规范化后的导入 JSON 输出文件")
    add_high_risk_confirmation(case_validate_parser)
    running_params_group = case_validate_parser.add_mutually_exclusive_group()
    running_params_group.add_argument(
        "--running-params-file",
        help="包含 mode 和 paramList 的多参数 JSON 文件",
    )
    running_params_group.add_argument(
        "--clear-running-params",
        action="store_true",
        help="移除用例高级设置中的多参数配置",
    )

    case_step_list_parser = subparsers.add_parser(
        "case-step-list", help="纯本地校验并查看导出用例的步骤"
    )
    case_step_list_parser.add_argument("--file", required=True, help="导出的用例 JSON 文件")
    case_step_list_parser.add_argument(
        "--index", type=non_negative_int, help="只查看从零开始的准确步骤索引"
    )

    def add_case_step_output_options(step_parser: argparse.ArgumentParser) -> None:
        step_parser.add_argument("--file", required=True, help="导出的源用例 JSON 文件")
        step_parser.add_argument("--output", required=True, help="不同于源文件的新用例 JSON 文件")
        step_parser.add_argument(
            "--overwrite",
            action="store_true",
            help="明确覆盖已存在的其他输出文件；始终禁止覆盖源文件",
        )

    case_step_add_parser = subparsers.add_parser(
        "case-step-add", help="纯本地校验并添加一个类型化用例步骤"
    )
    add_case_step_output_options(case_step_add_parser)
    case_step_add_parser.add_argument("--step-file", required=True, help="待添加的步骤 JSON 文件")
    case_step_add_parser.add_argument(
        "--at", type=non_negative_int, help="插入索引；省略时添加到末尾"
    )
    add_high_risk_confirmation(case_step_add_parser)

    case_step_update_parser = subparsers.add_parser(
        "case-step-update", help="纯本地校验并完整替换准确索引的步骤"
    )
    add_case_step_output_options(case_step_update_parser)
    case_step_update_parser.add_argument(
        "--index", required=True, type=non_negative_int, help="待替换的步骤索引"
    )
    case_step_update_parser.add_argument("--step-file", required=True, help="替换步骤 JSON 文件")
    add_high_risk_confirmation(case_step_update_parser)

    case_step_delete_parser = subparsers.add_parser(
        "case-step-delete", help="纯本地删除准确索引的步骤并重新校验用例"
    )
    add_case_step_output_options(case_step_delete_parser)
    case_step_delete_parser.add_argument(
        "--index", required=True, type=non_negative_int, help="待删除的步骤索引"
    )

    case_step_move_parser = subparsers.add_parser(
        "case-step-move", help="纯本地移动步骤并按新顺序重新校验用例"
    )
    add_case_step_output_options(case_step_move_parser)
    case_step_move_parser.add_argument(
        "--from-index", required=True, type=non_negative_int, help="原步骤索引"
    )
    case_step_move_parser.add_argument(
        "--to-index", required=True, type=non_negative_int, help="移动后的步骤索引"
    )
    add_high_risk_confirmation(case_step_move_parser)

    case_step_copy_parser = subparsers.add_parser(
        "case-step-copy", help="纯本地复制步骤、生成新步骤 ID 并重新校验用例"
    )
    add_case_step_output_options(case_step_copy_parser)
    case_step_copy_parser.add_argument(
        "--index", required=True, type=non_negative_int, help="待复制的步骤索引"
    )
    case_step_copy_parser.add_argument(
        "--to-index", required=True, type=non_negative_int, help="副本插入索引"
    )
    add_high_risk_confirmation(case_step_copy_parser)

    case_import_parser = subparsers.add_parser(
        "case-import", help="校验并通过 ADB 导入 SoloPi 用例"
    )
    case_import_parser.add_argument("--file", required=True, help="待导入的用例 JSON 文件")
    add_high_risk_confirmation(case_import_parser)
    case_import_parser.add_argument(
        "--replace", action="store_true", help="替换全部同名已有用例"
    )
    case_import_parser.add_argument("--import-timeout", type=positive_float, default=15, help="导入回执超时秒数")
    case_import_parser.add_argument("--poll-interval", type=positive_float, default=0.2, help="回执轮询间隔秒数")

    case_delete_parser = subparsers.add_parser(
        "case-delete", help="按名称删除用例并等待精确回执"
    )
    case_delete_parser.add_argument("--case", required=True, help="用例名称")
    case_delete_parser.add_argument("--delete-timeout", type=positive_float, default=15, help="删除回执超时秒数")
    case_delete_parser.add_argument("--poll-interval", type=positive_float, default=0.2, help="回执轮询间隔秒数")

    replay_history_list_parser = subparsers.add_parser(
        "replay-history-list", help="列出有界回放历史记录"
    )
    replay_history_list_parser.add_argument(
        "--limit", type=int, default=HISTORY_DEFAULT_LIMIT, help="返回条数，范围 1 到 500"
    )
    replay_history_get_parser = subparsers.add_parser(
        "replay-history-get", help="按不透明 ID 查询回放历史详情"
    )
    replay_history_get_parser.add_argument("--id", required=True, help="回放历史记录 ID")
    replay_history_delete_parser = subparsers.add_parser(
        "replay-history-delete", help="按不透明 ID 删除回放历史并等待精确回执"
    )
    replay_history_delete_parser.add_argument("--id", required=True, help="回放历史记录 ID")
    replay_history_delete_parser.add_argument(
        "--delete-timeout", type=positive_float, default=30, help="删除回执超时秒数"
    )
    replay_history_delete_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.2, help="回执轮询间隔秒数"
    )

    perf_history_list_parser = subparsers.add_parser(
        "perf-history-list", help="列出有界性能历史记录"
    )
    perf_history_list_parser.add_argument(
        "--limit", type=int, default=HISTORY_DEFAULT_LIMIT, help="返回条数，范围 1 到 500"
    )
    perf_history_get_parser = subparsers.add_parser(
        "perf-history-get", help="按不透明 ID 查询性能历史详情"
    )
    perf_history_get_parser.add_argument("--id", required=True, help="性能历史记录 ID")
    perf_history_delete_parser = subparsers.add_parser(
        "perf-history-delete", help="按不透明 ID 删除性能历史并等待精确回执"
    )
    perf_history_delete_parser.add_argument("--id", required=True, help="性能历史记录 ID")
    perf_history_delete_parser.add_argument(
        "--delete-timeout", type=positive_float, default=30, help="删除回执超时秒数"
    )
    perf_history_delete_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.2, help="回执轮询间隔秒数"
    )

    subparsers.add_parser(
        "plugin-list", help="列出已安装插件和受控导入目录中的插件包"
    )
    plugin_install_parser = subparsers.add_parser(
        "plugin-install", help="校验并通过受控 ADB 流程安装本地插件包"
    )
    plugin_install_parser.add_argument(
        "--file", required=True, help="本地插件 ZIP 文件"
    )
    plugin_install_parser.add_argument(
        "--install-timeout", type=positive_float, default=120, help="安装终态回执超时秒数"
    )
    plugin_install_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="回执轮询间隔秒数"
    )
    plugin_remove_parser = subparsers.add_parser(
        "plugin-remove", help="按稳定插件 ID 删除插件并等待精确回执"
    )
    plugin_remove_parser.add_argument(
        "--id", required=True, help="plugin-list 返回的稳定插件 ID"
    )
    plugin_remove_parser.add_argument(
        "--remove-timeout", type=positive_float, default=30, help="删除终态回执超时秒数"
    )
    plugin_remove_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="回执轮询间隔秒数"
    )

    subparsers.add_parser(
        "perf-list", help="列出所选设备支持的性能指标"
    )
    subparsers.add_parser(
        "perf-current", help="读取正在运行的性能监控实时值"
    )
    perf_display_status_parser = subparsers.add_parser(
        "perf-display-status", help="查询性能实时监控会话及当前指标值"
    )
    perf_display_status_parser.add_argument(
        "--session-id", help="仅接受匹配该 sessionId 的状态"
    )
    perf_display_start_parser = subparsers.add_parser(
        "perf-display-start", help="启动性能实时监控并等待运行确认"
    )
    perf_display_target_group = perf_display_start_parser.add_mutually_exclusive_group(
        required=True
    )
    perf_display_target_group.add_argument(
        "--target-package", help="目标应用包名"
    )
    perf_display_target_group.add_argument(
        "--global", dest="global_target", action="store_true", help="监控全局设备指标"
    )
    perf_display_start_parser.add_argument(
        "--items", required=True, help="perf-list 返回的逗号分隔指标键"
    )
    perf_display_start_parser.add_argument(
        "--ack-timeout", type=positive_float, default=30, help="启动确认超时秒数"
    )
    perf_display_start_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数"
    )
    perf_display_stop_parser = subparsers.add_parser(
        "perf-display-stop", help="停止准确的性能实时监控会话"
    )
    perf_display_stop_parser.add_argument(
        "--session-id", required=True, help="实时监控会话 ID"
    )
    perf_display_stop_parser.add_argument(
        "--stop-timeout", type=positive_float, default=60, help="停止确认超时秒数"
    )
    perf_display_stop_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数"
    )
    perf_analyze_parser = subparsers.add_parser(
        "perf-analyze", help="纯本地分析 UTF-8 或 GBK 性能 CSV 的描述性统计"
    )
    perf_analyze_parser.add_argument(
        "--input", required=True, help="包含性能 CSV 的本地证据目录"
    )

    startup_time_parser = subparsers.add_parser(
        "startup-time", help="使用 Android Activity Manager 测量应用启动耗时"
    )
    startup_time_parser.add_argument(
        "--target-package", required=True, help="被测应用包名"
    )
    startup_time_parser.add_argument(
        "--mode",
        choices=("cold", "warm"),
        default="cold",
        help="启动模式；cold 每轮强停后测量，warm 每轮先预热再测量",
    )
    startup_time_parser.add_argument(
        "--iterations", type=positive_int, default=5, help="测量轮数，默认 5"
    )
    startup_time_parser.add_argument(
        "--interval", type=non_negative_float, default=1.0, help="轮次间隔秒数，默认 1，可为 0"
    )
    startup_time_parser.add_argument(
        "--launch-timeout", type=positive_float, default=30.0, help="每轮等待应用启动的超时秒数，默认 30"
    )

    perf_status_parser = subparsers.add_parser(
        "perf-status", help="查询当前或最近一次性能录制状态"
    )
    perf_status_parser.add_argument(
        "--session-id", help="仅接受匹配该 sessionId 的状态"
    )

    perf_start_parser = subparsers.add_parser(
        "perf-start", help="启动性能录制并等待确认"
    )
    perf_target_group = perf_start_parser.add_mutually_exclusive_group(required=True)
    perf_target_group.add_argument("--target-package", help="目标应用包名")
    perf_target_group.add_argument(
        "--global", dest="global_target", action="store_true", help="采集全局设备指标"
    )
    perf_start_parser.add_argument(
        "--items", required=True, help="perf-list 返回的逗号分隔指标键"
    )
    perf_start_parser.add_argument("--ack-timeout", type=positive_float, default=30, help="启动确认超时秒数")
    perf_start_parser.add_argument("--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数")

    perf_stop_parser = subparsers.add_parser(
        "perf-stop", help="停止指定性能会话并可选拉取 CSV 文件"
    )
    perf_stop_parser.add_argument("--session-id", required=True, help="性能会话 ID")
    perf_stop_parser.add_argument("--stop-timeout", type=positive_float, default=60, help="停止确认超时秒数")
    perf_stop_parser.add_argument("--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数")
    perf_stop_parser.add_argument(
        "--output", help="将设备性能目录拉取到该全新本地路径"
    )

    record_status_parser = subparsers.add_parser(
        "record-status", help="查询当前或最近一次用例录制状态"
    )
    record_status_parser.add_argument(
        "--session-id", help="仅接受匹配该 sessionId 的状态"
    )
    record_start_parser = subparsers.add_parser(
        "record-start", help="启动命名用例录制并等待确认"
    )
    record_start_parser.add_argument("--name", required=True, help="新用例名称")
    record_start_parser.add_argument("--target-package", required=True, help="目标应用包名")
    record_start_parser.add_argument("--description", help="用例描述")
    record_start_parser.add_argument("--ack-timeout", type=positive_float, default=30, help="启动确认超时秒数")
    record_start_parser.add_argument("--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数")
    record_stop_parser = subparsers.add_parser(
        "record-stop", help="停止指定录制会话并等待用例落库"
    )
    record_stop_parser.add_argument("--session-id", required=True, help="录制会话 ID")
    record_stop_parser.add_argument("--stop-timeout", type=positive_float, default=60, help="停止确认超时秒数")
    record_stop_parser.add_argument("--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数")

    screen_record_status_parser = subparsers.add_parser(
        "screen-record-status", help="查询当前或最近一次独立屏幕录制状态"
    )
    screen_record_status_parser.add_argument(
        "--session-id", help="仅接受匹配该 sessionId 的状态"
    )
    screen_record_start_parser = subparsers.add_parser(
        "screen-record-start",
        help="启动独立录屏；必须由用户在手机系统框确认，CLI 不会自动授权",
    )
    screen_record_start_parser.add_argument(
        "--resolution", default="720x480", help="偶数宽x高，范围均为 128 到 4096"
    )
    screen_record_start_parser.add_argument(
        "--bitrate-kbps", type=int, default=2500, help="视频码率 Kbps，范围 100 到 50000"
    )
    screen_record_start_parser.add_argument(
        "--frame-rate", type=int, default=30, help="视频帧率，范围 1 到 120"
    )
    screen_record_start_parser.add_argument(
        "--duration", type=int, default=300, help="自动停止秒数，范围 1 到 3600"
    )
    screen_record_start_parser.add_argument(
        "--ack-timeout", type=positive_float, default=120, help="等待用户确认并开始编码的超时秒数"
    )
    screen_record_start_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数"
    )
    screen_record_stop_parser = subparsers.add_parser(
        "screen-record-stop", help="停止准确录屏会话并可选拉取非空 MP4"
    )
    screen_record_stop_parser.add_argument(
        "--session-id", required=True, help="独立录屏会话 ID"
    )
    screen_record_stop_parser.add_argument(
        "--stop-timeout", type=positive_float, default=60, help="停止及文件落盘超时秒数"
    )
    screen_record_stop_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数"
    )
    screen_record_stop_parser.add_argument(
        "--output", help="将非空 MP4 拉取到该全新本地文件路径"
    )

    scan_status_parser = subparsers.add_parser(
        "scan-status", help="查询当前或最近一次相机扫码会话及只读结果"
    )
    scan_status_parser.add_argument(
        "--session-id", help="仅接受匹配该 sessionId 的扫码状态"
    )
    scan_start_parser = subparsers.add_parser(
        "scan-start",
        help="打开相机扫码页面；权限和取景由用户确认，内容绝不自动执行",
    )
    scan_start_parser.add_argument(
        "--ack-timeout", type=positive_float, default=30, help="扫码页面就绪确认超时秒数"
    )
    scan_start_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数"
    )
    scan_cancel_parser = subparsers.add_parser(
        "scan-cancel", help="按准确 sessionId 取消相机扫码会话"
    )
    scan_cancel_parser.add_argument(
        "--session-id", required=True, help="scan-start 返回的扫码会话 ID"
    )
    scan_cancel_parser.add_argument(
        "--cancel-timeout", type=positive_float, default=15, help="取消终态确认超时秒数"
    )
    scan_cancel_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数"
    )

    video_analysis_start_parser = subparsers.add_parser(
        "video-analysis-start", help="分析设备 ScreenCaptures 中的 SoloPi 录屏"
    )
    video_analysis_start_parser.add_argument(
        "--video-path", required=True, help="设备 ScreenCaptures 直属 MP4 的绝对路径"
    )
    video_analysis_start_parser.add_argument(
        "--action-offset-ms",
        required=True,
        type=video_action_offset_ms,
        help="动作发生相对录屏起点的毫秒偏移，范围 0 到 3600000",
    )
    video_analysis_start_parser.add_argument(
        "--difference-threshold",
        required=True,
        type=video_difference_threshold,
        help="视频帧差异阈值，大于 0 且不超过 1",
    )
    video_analysis_start_parser.add_argument(
        "--wait",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="是否等待 completed 或 failed 终态",
    )
    video_analysis_start_parser.add_argument(
        "--ack-timeout", type=positive_float, default=15, help="启动回执超时秒数"
    )
    video_analysis_start_parser.add_argument(
        "--analysis-timeout", type=positive_float, default=120, help="分析终态超时秒数"
    )
    video_analysis_start_parser.add_argument(
        "--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数"
    )
    video_analysis_status_parser = subparsers.add_parser(
        "video-analysis-status", help="按准确 requestId 查询视频分析状态"
    )
    video_analysis_status_parser.add_argument(
        "--request-id", required=True, help="启动命令返回的视频分析 requestId"
    )

    stress_status_parser = subparsers.add_parser(
        "stress-status", help="查询当前或最近一次有界加压会话"
    )
    stress_status_parser.add_argument(
        "--session-id", help="仅接受匹配该 sessionId 的状态"
    )
    stress_start_parser = subparsers.add_parser(
        "stress-start", help="启动有界 CPU 和/或内存加压"
    )
    stress_start_parser.add_argument("--cpu-count", type=int, help="加压线程数；不能超过设备在线 CPU 数")
    stress_start_parser.add_argument("--cpu-percent", type=int, help="CPU 加压比例，范围 1 到 100")
    stress_start_parser.add_argument("--memory", type=int, help="内存加压 MB 数，最大 2048")
    stress_start_parser.add_argument("--duration", type=int, default=60, help="自动停止秒数，范围 1 到 3600")
    stress_start_parser.add_argument("--ack-timeout", type=positive_float, default=30, help="启动确认超时秒数")
    stress_start_parser.add_argument("--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数")
    stress_stop_parser = subparsers.add_parser(
        "stress-stop", help="停止指定加压会话并等待确认"
    )
    stress_stop_parser.add_argument("--session-id", required=True, help="加压会话 ID")
    stress_stop_parser.add_argument("--stop-timeout", type=positive_float, default=30, help="停止确认超时秒数")
    stress_stop_parser.add_argument("--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数")

    agent_start_parser = subparsers.add_parser(
        "agent-session-start", help="启动有界动态 Agent 会话并返回首帧观察"
    )
    agent_start_parser.add_argument(
        "--owner-token", help="可选 URL-safe 会话所有权令牌；省略时安全生成"
    )
    agent_start_parser.add_argument("--max-steps", type=positive_int, default=50, help="最大接受动作数，最高 200")
    agent_start_parser.add_argument("--max-duration-ms", type=positive_int, default=300000, help="会话总时长毫秒，最高 1800000")
    agent_start_parser.add_argument("--idle-timeout-ms", type=positive_int, default=30000, help="空闲超时毫秒，最高 300000")
    agent_start_parser.add_argument("--max-repeated-actions", type=positive_int, default=3, help="相同动作连续执行上限，最高 20")
    agent_start_parser.add_argument("--max-no-progress-steps", type=positive_int, default=3, help="UI 无变化步骤上限，最高 20")
    agent_start_parser.add_argument("--ack-timeout", type=positive_float, default=15, help="等待首帧观察超时秒数")
    agent_start_parser.add_argument("--poll-interval", type=positive_float, default=0.2, help="启动状态轮询间隔秒数")

    def add_agent_identity(command_parser: argparse.ArgumentParser) -> None:
        command_parser.add_argument("--session-id", required=True, help="准确动态 Agent sessionId")
        command_parser.add_argument("--owner-token", required=True, help="启动命令返回的所有权令牌")

    agent_observe_parser = subparsers.add_parser(
        "agent-observe", help="为准确会话生成新 UI 观察"
    )
    add_agent_identity(agent_observe_parser)

    agent_act_parser = subparsers.add_parser(
        "agent-act", help="基于准确 observationId 执行一个类型化动作"
    )
    add_agent_identity(agent_act_parser)
    agent_act_parser.add_argument("--step-id", required=True, help="会话内唯一且幂等的 stepId")
    agent_act_parser.add_argument("--observation-id", required=True, help="待消费的准确 observationId")
    agent_act_parser.add_argument("--action", required=True, choices=AGENT_ACTIONS, help="受控类型化动作")
    agent_act_parser.add_argument("--node-id", help="当前观察返回的帧内 nodeId")
    agent_act_parser.add_argument("--text", help="input 动作的文本")
    agent_act_parser.add_argument("--direction", choices=("up", "down", "left", "right"), help="scroll 方向")
    agent_act_parser.add_argument("--duration-ms", type=positive_int, help="longClick 或 wait 时长，100 到 5000")
    agent_act_parser.add_argument("--distance", type=positive_int, help="scroll 距离百分比，1 到 90")
    agent_act_parser.add_argument("--action-timeout", type=positive_float, default=15, help="等待 settle 后回执超时秒数")
    agent_act_parser.add_argument("--poll-interval", type=positive_float, default=0.2, help="回执轮询间隔秒数")

    agent_status_parser = subparsers.add_parser("agent-status", help="查询准确动态 Agent 会话状态")
    add_agent_identity(agent_status_parser)
    agent_timeline_parser = subparsers.add_parser("agent-timeline", help="读取准确会话的只追加证据时间线")
    add_agent_identity(agent_timeline_parser)

    for command_name, command_help in (
        ("agent-pause", "暂停动态 Agent 会话"),
        ("agent-resume", "恢复已暂停的动态 Agent 会话"),
        ("agent-end", "正常结束动态 Agent 会话并释放租约"),
        ("agent-cancel", "取消动态 Agent 会话并释放租约"),
    ):
        command_parser = subparsers.add_parser(command_name, help=command_help)
        add_agent_identity(command_parser)
        command_parser.add_argument("--ack-timeout", type=positive_float, default=15, help="状态确认超时秒数")
        command_parser.add_argument("--poll-interval", type=positive_float, default=0.2, help="状态轮询间隔秒数")

    verify_normalize_parser = subparsers.add_parser(
        "verify-normalize", help="将结构化需求和 AC 规范化为版本化契约"
    )
    verify_normalize_parser.add_argument("--file", required=True, help="需求契约 JSON")
    verify_normalize_parser.add_argument("--output", help="规范化需求 JSON 输出路径")

    verify_compile_parser = subparsers.add_parser(
        "verify-compile", help="编译 Goal Tree、Test Intent IR 和可执行验证计划"
    )
    verify_compile_parser.add_argument("--file", required=True, help="需求契约 JSON")
    verify_compile_parser.add_argument("--output", required=True, help="验证计划 JSON 输出路径")
    verify_compile_parser.add_argument(
        "--cases-dir", help="可选：导出编译后的固定 SoloPi 用例"
    )

    verify_validate_parser = subparsers.add_parser(
        "verify-validate", help="离线静态校验验证计划和内容指纹"
    )
    verify_validate_parser.add_argument("--plan", required=True, help="验证计划 JSON")

    def add_model_public_key(command_parser: argparse.ArgumentParser) -> None:
        command_parser.add_argument(
            "--public-key",
            default=str(DEFAULT_MODEL_PUBLIC_KEY),
            help="可信 SHA256withRSA 模型签名公钥 PEM",
        )

    model_verify_parser = subparsers.add_parser(
        "model-verify", help="离线验证模型清单、摘要、签名和可选设备兼容性"
    )
    model_verify_parser.add_argument("--package", required=True, help="含 manifest.json 的模型包目录")
    model_verify_parser.add_argument("--api-level", type=positive_int, help="可选目标 Android API")
    model_verify_parser.add_argument("--abi", help="与 --api-level 同时使用的目标 ABI")
    add_model_public_key(model_verify_parser)

    model_health_parser = subparsers.add_parser(
        "model-health", help="查询独立端侧模型 companion 和后端能力"
    )
    add_model_public_key(model_health_parser)

    model_install_parser = subparsers.add_parser(
        "model-install", help="双重验证并原子安装签名模型包"
    )
    model_install_parser.add_argument("--package", required=True, help="签名模型包目录")
    add_model_public_key(model_install_parser)

    model_status_parser = subparsers.add_parser(
        "model-status", help="查询已安装、活动和可回退模型版本"
    )
    model_status_parser.add_argument("--model-id", help="可选准确模型 ID")
    add_model_public_key(model_status_parser)

    model_activate_parser = subparsers.add_parser(
        "model-activate", help="加载成功后原子激活准确模型版本"
    )
    model_activate_parser.add_argument("--model-id", required=True)
    model_activate_parser.add_argument("--model-version", required=True)
    add_model_public_key(model_activate_parser)

    model_rollback_parser = subparsers.add_parser(
        "model-rollback", help="回退到同一模型的上一个有效版本"
    )
    model_rollback_parser.add_argument("--model-id", required=True)
    add_model_public_key(model_rollback_parser)

    def add_model_inference(command_parser: argparse.ArgumentParser) -> None:
        command_parser.add_argument("--model-id", required=True)
        command_parser.add_argument("--model-version")
        inputs = command_parser.add_mutually_exclusive_group(required=True)
        inputs.add_argument("--inputs", help="张量数组 JSON，例如 [[0],[1]]")
        inputs.add_argument("--inputs-file", help="张量数组 JSON 文件")
        add_model_public_key(command_parser)

    model_infer_parser = subparsers.add_parser(
        "model-infer", help="通过活动 ExecuTorch 模型执行一次类型化推理"
    )
    add_model_inference(model_infer_parser)

    model_benchmark_parser = subparsers.add_parser(
        "model-benchmark", help="采集端侧冷启动、首决策、P50/P95、内存和功耗"
    )
    add_model_inference(model_benchmark_parser)
    model_benchmark_parser.add_argument(
        "--package", required=True, help="用于绑定基准证据的签名模型包目录"
    )
    model_benchmark_parser.add_argument("--warmup", type=non_negative_int, default=2)
    model_benchmark_parser.add_argument("--iterations", type=positive_int, default=20)
    model_benchmark_parser.add_argument("--output", help="基准 JSON 输出路径")

    model_release_parser = subparsers.add_parser(
        "model-release-check", help="按签名清单阈值阻断不兼容或不达标模型"
    )
    model_release_parser.add_argument("--package", required=True)
    model_release_parser.add_argument("--benchmark", required=True, help="model-benchmark JSON")
    model_release_parser.add_argument("--evaluation", required=True, help="准确率和任务成功率 JSON")
    model_release_parser.add_argument("--output", help="发布门禁报告 JSON")
    add_model_public_key(model_release_parser)

    verify_run_parser = subparsers.add_parser(
        "verify-run", help="按 deterministic、dynamic 或 hybrid 路由执行验证计划"
    )
    verify_run_parser.add_argument("--plan", required=True, help="已通过静态校验的验证计划 JSON")
    verify_run_parser.add_argument("--artifacts", required=True, help="必须不存在的统一证据目录")
    verify_run_parser.add_argument(
        "--agent-decisions", help="可选外部 Agent typed act/done/blocked 决策 JSON"
    )
    verify_run_parser.add_argument(
        "--decision-provider",
        choices=("static", "on-device", "cloud"),
        default="static",
        help="动态段决策来源；默认兼容静态决策文件",
    )
    verify_run_parser.add_argument("--model-package", help="端侧 provider 的签名模型包目录")
    verify_run_parser.add_argument("--model-id", help="可选：核对签名模型 ID")
    verify_run_parser.add_argument("--model-version", help="可选：核对签名模型版本")
    verify_run_parser.add_argument("--cloud-endpoint", help="cloud provider 的 HTTPS/HTTP typed 决策端点")
    verify_run_parser.add_argument(
        "--cloud-fallback-endpoint", help="仅端侧基础设施失败时使用的 cloud typed 决策端点"
    )
    add_model_public_key(verify_run_parser)
    verify_run_parser.add_argument(
        "--restart-app",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="固定测试段是否重启目标 App；清理段始终不重启",
    )
    verify_run_parser.add_argument("--run-timeout", type=positive_float, default=600, help="单个固定用例终态超时秒数")
    verify_run_parser.add_argument("--import-timeout", type=positive_float, default=30, help="固定用例导入确认超时秒数")
    verify_run_parser.add_argument("--ack-timeout", type=positive_float, default=20, help="固定用例启动确认超时秒数")
    verify_run_parser.add_argument("--agent-start-timeout", type=positive_float, default=30, help="动态 Agent 首帧超时秒数")
    verify_run_parser.add_argument("--agent-action-timeout", type=positive_float, default=20, help="动态 Agent 单步 settle 超时秒数")
    verify_run_parser.add_argument("--agent-end-timeout", type=positive_float, default=15, help="动态 Agent 清理确认超时秒数")
    verify_run_parser.add_argument("--poll-interval", type=positive_float, default=0.2, help="协议轮询间隔秒数")

    managed_database_default = os.environ.get(
        "SOLOPI_MANAGED_DB", str(Path.home() / ".solopi-ai" / "managed.sqlite")
    )

    def add_managed_database(command_parser: argparse.ArgumentParser) -> None:
        command_parser.add_argument(
            "--database",
            default=managed_database_default,
            help="SQLite 控制面数据库路径",
        )

    for command_name, command_help in (
        ("managed-init", "初始化持久控制面数据库"),
        ("managed-health", "查询控制面、设备池和任务队列健康摘要"),
    ):
        command_parser = subparsers.add_parser(command_name, help=command_help)
        add_managed_database(command_parser)

    managed_register_parser = subparsers.add_parser(
        "managed-device-register", help="持久注册一台已知 Android 设备"
    )
    add_managed_database(managed_register_parser)
    managed_register_parser.add_argument("--device-id", required=True, help="稳定设备 ID")
    managed_register_parser.add_argument("--device-serial", required=True, help="准确 ADB serial")
    managed_register_parser.add_argument("--api-level", type=positive_int, required=True, help="Android API 级别")
    managed_register_parser.add_argument("--capability", action="append", default=[], help="可重复的能力标签")
    managed_register_parser.add_argument("--label", action="append", default=[], help="可重复 key=value 标签")
    managed_register_parser.add_argument(
        "--health",
        choices=sorted(managed_execution.DEVICE_HEALTH),
        default="healthy",
        help="初始健康状态",
    )

    managed_probe_parser = subparsers.add_parser(
        "managed-device-probe", help="探测当前 ADB 设备并更新设备池"
    )
    add_managed_database(managed_probe_parser)
    managed_probe_parser.add_argument("--device-id", help="稳定设备 ID；默认使用 ADB serial")
    managed_probe_parser.add_argument("--capability", action="append", default=[], help="附加能力标签")
    managed_probe_parser.add_argument("--label", action="append", default=[], help="可重复 key=value 标签")

    managed_list_parser = subparsers.add_parser(
        "managed-device-list", help="列出设备池能力、健康和租约状态"
    )
    add_managed_database(managed_list_parser)

    managed_submit_parser = subparsers.add_parser(
        "managed-submit", help="幂等提交验证计划和设备矩阵"
    )
    add_managed_database(managed_submit_parser)
    managed_submit_parser.add_argument("--plan", required=True, help="验证计划 JSON")
    managed_submit_parser.add_argument("--matrix", required=True, help="设备矩阵 JSON")
    managed_submit_parser.add_argument("--agent-decisions", help="可选动态 Agent 决策 JSON")
    managed_submit_parser.add_argument("--idempotency-key", required=True, help="调用方幂等键")
    managed_submit_parser.add_argument("--owner-token", help="任务 owner token；省略时安全生成")
    managed_submit_parser.add_argument("--max-retries", type=non_negative_int, default=1, help="基础设施失败最大重试次数")
    managed_submit_parser.add_argument("--lease-duration-ms", type=positive_int, default=60000, help="worker generation 租约毫秒数")
    managed_submit_parser.add_argument("--retention-ms", type=non_negative_int, default=604800000, help="原始证据保留毫秒数")

    for command_name, command_help in (
        ("managed-status", "查询任务和 shard 状态"),
        ("managed-events", "读取任务只追加进度事件"),
        ("managed-report", "读取矩阵汇总报告和稳定退出码"),
    ):
        command_parser = subparsers.add_parser(command_name, help=command_help)
        add_managed_database(command_parser)
        command_parser.add_argument("--task-id", required=True, help="准确 taskId")
        if command_name == "managed-events":
            command_parser.add_argument("--after-sequence", type=non_negative_int, default=0, help="只返回此序号之后的事件")
        if command_name == "managed-report":
            command_parser.add_argument("--output", help="可选报告 JSON 输出路径")

    managed_cancel_parser = subparsers.add_parser(
        "managed-cancel", help="使用准确 owner token 取消任务"
    )
    add_managed_database(managed_cancel_parser)
    managed_cancel_parser.add_argument("--task-id", required=True, help="准确 taskId")
    managed_cancel_parser.add_argument("--owner-token", required=True, help="任务 owner token")

    managed_recover_parser = subparsers.add_parser(
        "managed-recover", help="回收过期租约并恢复或终结 shard"
    )
    add_managed_database(managed_recover_parser)

    def add_managed_worker_options(command_parser: argparse.ArgumentParser) -> None:
        add_managed_database(command_parser)
        command_parser.add_argument("--worker-id", required=True, help="稳定 worker ID")
        command_parser.add_argument("--artifacts-root", required=True, help="证据父目录")
        command_parser.add_argument(
            "--restart-app", action=argparse.BooleanOptionalAction, default=None,
            help="固定测试段是否重启目标 App",
        )
        command_parser.add_argument("--run-timeout", type=positive_float, default=600)
        command_parser.add_argument("--import-timeout", type=positive_float, default=30)
        command_parser.add_argument("--ack-timeout", type=positive_float, default=20)
        command_parser.add_argument("--agent-start-timeout", type=positive_float, default=30)
        command_parser.add_argument("--agent-action-timeout", type=positive_float, default=20)
        command_parser.add_argument("--agent-end-timeout", type=positive_float, default=15)
        command_parser.add_argument("--poll-interval", type=positive_float, default=0.2)

    managed_once_parser = subparsers.add_parser(
        "managed-worker-once", help="领取并执行一个准确 assignment"
    )
    add_managed_worker_options(managed_once_parser)

    managed_loop_parser = subparsers.add_parser(
        "managed-worker-loop", help="持续领取并执行托管任务"
    )
    add_managed_worker_options(managed_loop_parser)
    managed_loop_parser.add_argument("--idle-interval", type=positive_float, default=1, help="无任务轮询间隔秒数")
    managed_loop_parser.add_argument("--max-idle-polls", type=non_negative_int, default=0, help="有界 CI worker 空闲轮询数；0 表示不限")
    managed_loop_parser.add_argument("--max-assignments", type=non_negative_int, default=0, help="最多处理任务数；0 表示不限")

    managed_serve_parser = subparsers.add_parser(
        "managed-serve", help="启动受 Bearer 鉴权的 loopback HTTP API"
    )
    add_managed_database(managed_serve_parser)
    managed_serve_parser.add_argument("--bearer-token", required=True, help="HTTP Bearer 令牌")
    managed_serve_parser.add_argument("--bind", default="127.0.0.1", help="只允许 loopback 地址")
    managed_serve_parser.add_argument("--port", type=non_negative_int, default=8765, help="监听端口；0 表示自动分配")

    run_parser = subparsers.add_parser("run", help="运行已录制用例并等待证据")
    run_parser.add_argument("--case", required=True, help="用例名称")
    run_parser.add_argument(
        "--target-package", help="可选目标应用包名；覆盖用例保存的目标应用"
    )
    run_parser.add_argument(
        "--restart-app",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="是否在回放前重启目标应用；省略时沿用用例或设备策略",
    )
    run_parser.add_argument("--wait", action=argparse.BooleanOptionalAction, default=True, help="是否等待终态结果")
    run_parser.add_argument("--run-timeout", type=positive_float, default=600, help="回放终态超时秒数")
    run_parser.add_argument("--ack-timeout", type=positive_float, default=15, help="启动确认超时秒数")
    run_parser.add_argument("--poll-interval", type=positive_float, default=1, help="状态轮询间隔秒数")
    run_parser.add_argument("--artifacts", help="保存 result.json、screen.png 和 logcat.txt 的目录")
    run_parser.add_argument("--no-auto-start", action="store_true", help="不自动开启回放自动启动配置")
    add_high_risk_confirmation(run_parser)

    def add_sequence_run_options(sequence_parser: argparse.ArgumentParser) -> None:
        sequence_parser.add_argument(
            "--target-package", help="所有子运行使用的可选目标应用包名覆盖"
        )
        sequence_parser.add_argument(
            "--restart-app",
            action=argparse.BooleanOptionalAction,
            default=None,
            help="所有子运行是否在回放前重启目标应用；省略时沿用原策略",
        )
        sequence_parser.add_argument("--run-timeout", type=positive_float, default=600, help="单次回放终态超时秒数")
        sequence_parser.add_argument("--ack-timeout", type=positive_float, default=15, help="单次启动确认超时秒数")
        sequence_parser.add_argument("--poll-interval", type=positive_float, default=1, help="状态轮询间隔秒数")
        sequence_parser.add_argument(
            "--artifacts", help="证据父目录；每次运行使用批次隔离子目录"
        )
        sequence_parser.add_argument("--no-auto-start", action="store_true", help="不自动开启回放自动启动配置")
        add_high_risk_confirmation(sequence_parser)
        sequence_parser.add_argument("--continue-on-failure", action="store_true", help="子运行失败后继续执行")

    repeat_parser = subparsers.add_parser(
        "run-repeat", help="重复运行一个用例并输出每轮精确结果"
    )
    repeat_parser.add_argument("--case", required=True, help="用例名称")
    repeat_parser.add_argument("--times", type=positive_int, required=True, help="重复次数")
    add_sequence_run_options(repeat_parser)

    batch_parser = subparsers.add_parser(
        "run-batch", help="按顺序运行多个用例并输出逐次精确证据"
    )
    batch_parser.add_argument("--case", action="append", required=True, help="用例名称；可重复传入")
    add_sequence_run_options(batch_parser)

    cancel_parser = subparsers.add_parser("cancel", help="按准确 runId 取消 Harness 回放")
    cancel_parser.add_argument(
        "--run-id", required=True, help="启动命令返回且属于本任务的回放 runId"
    )
    cancel_parser.add_argument("--cancel-timeout", type=positive_float, default=30, help="取消确认超时秒数")
    cancel_parser.add_argument("--poll-interval", type=positive_float, default=0.5, help="状态轮询间隔秒数")

    screenshot_parser = subparsers.add_parser("screenshot", help="截取当前设备屏幕")
    screenshot_parser.add_argument("--output", required=True, help="PNG 输出文件")
    logs_parser = subparsers.add_parser("logs", help="采集当前设备 logcat")
    logs_parser.add_argument("--output", required=True, help="日志输出文件")
    return parser


def dispatch(args: argparse.Namespace, adb: AdbClient) -> tuple[Dict[str, Any], int]:
    if args.command == "doctor":
        return command_doctor(args, adb)
    if args.command == "adb-connect":
        return command_adb_connect(args, adb)
    if args.command in {"capabilities", "cases", "apps", "status"}:
        return command_query(args, adb, args.command)
    if args.command == "app-info":
        return command_query(args, adb, "info")
    if args.command == "actions":
        return command_actions(args, adb)
    if args.command == "app-status":
        return command_app_status(args, adb)
    if args.command == "config-list":
        return command_config_list(args, adb)
    if args.command == "config-get":
        return command_config_get(args, adb)
    if args.command == "config-set":
        return command_config_set(args, adb)
    if args.command == "result":
        return command_result(args, adb)
    if args.command == "case-get":
        return command_case_get(args, adb)
    if args.command == "case-template":
        return command_case_template(args, adb)
    if args.command == "case-validate":
        return command_case_validate(args, adb)
    if args.command == "case-step-list":
        return command_case_step_list(args, adb)
    if args.command == "case-step-add":
        return command_case_step_add(args, adb)
    if args.command == "case-step-update":
        return command_case_step_update(args, adb)
    if args.command == "case-step-delete":
        return command_case_step_delete(args, adb)
    if args.command == "case-step-move":
        return command_case_step_move(args, adb)
    if args.command == "case-step-copy":
        return command_case_step_copy(args, adb)
    if args.command == "case-import":
        return command_case_import(args, adb)
    if args.command == "case-delete":
        return command_case_delete(args, adb)
    if args.command == "replay-history-list":
        return command_history_list(args, adb, "replay")
    if args.command == "replay-history-get":
        return command_history_get(args, adb, "replay")
    if args.command == "replay-history-delete":
        return command_history_delete(args, adb, "replay")
    if args.command == "perf-history-list":
        return command_history_list(args, adb, "performance")
    if args.command == "perf-history-get":
        return command_history_get(args, adb, "performance")
    if args.command == "perf-history-delete":
        return command_history_delete(args, adb, "performance")
    if args.command == "plugin-list":
        return command_plugin_list(args, adb)
    if args.command == "plugin-install":
        return command_plugin_install(args, adb)
    if args.command == "plugin-remove":
        return command_plugin_remove(args, adb)
    if args.command == "inspect":
        return command_inspect(args, adb)
    if args.command == "perf-list":
        return command_perf_list(args, adb)
    if args.command == "perf-current":
        return command_perf_current(args, adb)
    if args.command == "perf-display-status":
        return command_perf_display_status(args, adb)
    if args.command == "perf-display-start":
        return command_perf_display_start(args, adb)
    if args.command == "perf-display-stop":
        return command_perf_display_stop(args, adb)
    if args.command == "perf-analyze":
        return command_perf_analyze(args, adb)
    if args.command == "startup-time":
        return command_startup_time(args, adb)
    if args.command == "perf-status":
        return command_perf_status(args, adb)
    if args.command == "perf-start":
        return command_perf_start(args, adb)
    if args.command == "perf-stop":
        return command_perf_stop(args, adb)
    if args.command == "record-status":
        return command_record_status(args, adb)
    if args.command == "record-start":
        return command_record_start(args, adb)
    if args.command == "record-stop":
        return command_record_stop(args, adb)
    if args.command == "screen-record-status":
        return command_screen_record_status(args, adb)
    if args.command == "screen-record-start":
        return command_screen_record_start(args, adb)
    if args.command == "screen-record-stop":
        return command_screen_record_stop(args, adb)
    if args.command == "scan-status":
        return command_scan_status(args, adb)
    if args.command == "scan-start":
        return command_scan_start(args, adb)
    if args.command == "scan-cancel":
        return command_scan_cancel(args, adb)
    if args.command == "video-analysis-start":
        return command_video_analysis_start(args, adb)
    if args.command == "video-analysis-status":
        return command_video_analysis_status(args, adb)
    if args.command == "stress-status":
        return command_stress_status(args, adb)
    if args.command == "stress-start":
        return command_stress_start(args, adb)
    if args.command == "stress-stop":
        return command_stress_stop(args, adb)
    if args.command == "agent-session-start":
        return command_agent_session_start(args, adb)
    if args.command == "agent-observe":
        return command_agent_observe(args, adb)
    if args.command == "agent-act":
        return command_agent_act(args, adb)
    if args.command == "agent-status":
        return command_agent_query(args, adb, "status")
    if args.command == "agent-timeline":
        return command_agent_query(args, adb, "timeline")
    if args.command in {"agent-pause", "agent-resume", "agent-end", "agent-cancel"}:
        return command_agent_mutation(args, adb, args.command[len("agent-"):])
    if args.command == "verify-normalize":
        return command_verify_normalize(args, adb)
    if args.command == "verify-compile":
        return command_verify_compile(args, adb)
    if args.command == "verify-validate":
        return command_verify_validate(args, adb)
    if args.command == "verify-run":
        return command_verify_run(args, adb)
    if args.command == "model-verify":
        return command_model_verify(args, adb)
    if args.command == "model-health":
        return command_model_health(args, adb)
    if args.command == "model-install":
        return command_model_install(args, adb)
    if args.command == "model-status":
        return command_model_status(args, adb)
    if args.command == "model-activate":
        return command_model_activate(args, adb)
    if args.command == "model-rollback":
        return command_model_rollback(args, adb)
    if args.command == "model-infer":
        return command_model_infer(args, adb)
    if args.command == "model-benchmark":
        return command_model_benchmark(args, adb)
    if args.command == "model-release-check":
        return command_model_release_check(args, adb)
    if args.command in {"managed-init", "managed-health"}:
        return command_managed_health(args, adb)
    if args.command == "managed-device-register":
        return command_managed_device_register(args, adb)
    if args.command == "managed-device-probe":
        return command_managed_device_probe(args, adb)
    if args.command == "managed-device-list":
        return command_managed_device_list(args, adb)
    if args.command == "managed-submit":
        return command_managed_submit(args, adb)
    if args.command == "managed-status":
        return command_managed_status(args, adb)
    if args.command == "managed-events":
        return command_managed_events(args, adb)
    if args.command == "managed-report":
        return command_managed_report(args, adb)
    if args.command == "managed-cancel":
        return command_managed_cancel(args, adb)
    if args.command == "managed-recover":
        return command_managed_recover(args, adb)
    if args.command == "managed-worker-once":
        return command_managed_worker_once(args, adb)
    if args.command == "managed-worker-loop":
        return command_managed_worker_loop(args, adb)
    if args.command == "managed-serve":
        return command_managed_serve(args, adb)
    if args.command == "run":
        return command_run(args, adb)
    if args.command == "run-repeat":
        return command_run_repeat(args, adb)
    if args.command == "run-batch":
        return command_run_batch(args, adb)
    if args.command == "cancel":
        return command_cancel(args, adb)
    if args.command == "screenshot":
        return command_screenshot(args, adb)
    if args.command == "logs":
        return command_logs(args, adb)
    raise CliError("不支持的命令：%s" % args.command, 3)


def emit(payload: Dict[str, Any], pretty: bool) -> None:
    indent = 2 if pretty else None
    print(json.dumps(payload, ensure_ascii=False, indent=indent, sort_keys=pretty))


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    adb = AdbClient(args.adb, args.serial, control_package=args.package)
    try:
        payload, exit_code = dispatch(args, adb)
    except CliError as exc:
        payload = {"success": False, "error": str(exc)}
        payload.update(exc.details)
        exit_code = exc.exit_code
    except KeyboardInterrupt:
        payload = {"success": False, "error": "操作被中断"}
        exit_code = 130
    emit(payload, args.pretty)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
