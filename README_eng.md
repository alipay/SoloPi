# <img src="solopi-app/assets/icon.png" width="48" alt="SoloPi" /> SoloPi

[![GitHub stars](https://img.shields.io/github/stars/alipay/SoloPi.svg)](https://github.com/alipay/SoloPi)
[![License](https://img.shields.io/github/license/alipay/SoloPi.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/alipay/SoloPi)](https://github.com/alipay/SoloPi/releases/latest)

[Website](https://www.solopi.cn/) · [Download APK](https://github.com/alipay/SoloPi/releases/latest) · [中文](README.md) · [Issues](https://github.com/alipay/SoloPi/issues) · [Contributing](CONTRIBUTING.md)

**Open-source mobile automation from physical-device actions to reviewable test outcomes.**

SoloPi provides Android record and replay, performance tooling, a desktop workbench, and a Skill /
Harness for AI Agents. Use it to inspect devices, record and replay cases from a computer, or let an
Agent operate within an explicit action boundary. Predefined checkpoints and evidence from the
current run determine the final result.

The app under test normally does not need to integrate a SoloPi SDK. Review [platform support](#platform-support)
before relying on a feature across different operating systems, devices, or applications.

## What You Can Do

- **Record and replay:** Capture Android interactions and repeat them on a device, or use Desktop to record, edit, and replay fixed cases.
- **Observe and verify:** Inspect the current page, select locatable nodes, define checkpoints, and retain receipts, screenshots, and results.
- **Diagnose performance:** Collect supported CPU, memory, frame-rate, battery, temperature, startup-time, log, and recording evidence.
- **Work with Agents:** Convert natural-language tasks into constrained observations and actions through the Skill and Harness; an Agent's completion claim does not replace acceptance checks.
- **Integrate automation:** Run cases through a typed CLI and consume structured reports; managed execution adds single-host queues, leases, and bounded retries.

### From Device Action to Test Outcome

```text
Desktop / Agent task / CLI
            |
            v
    SoloPi Skill + Harness
  Plan, session, receipts, evidence
            |
            v
 Android SoloPi / iOS WDA / NEXT driver
            |
            v
    Observe -> constrained action
            |
            v
 Fixed checkpoints + independent judge
            |
            v
    passed / failed / not_tested
```

`passed` means all required checkpoints and cleanup conditions succeeded. `failed` means the
observed outcome did not meet the expectation. `not_tested` means the available evidence is
insufficient. An action with an unknown outcome must not be retried blindly.

## Repository Structure

| Directory | Contents | Best for |
|---|---|---|
| [`solopi-app/`](solopi-app/README_eng.md) | Android app, record and replay, performance tools, and device-side execution | Using or extending Android capabilities |
| [`solopi-desktop/`](solopi-desktop/README.md) | Electron workbench, device control, case orchestration, and reports | Operating devices and managing tests through a GUI |
| [`solopi-skill/`](solopi-skill/SKILL.md) | Agent rules and the built-in Harness under `scripts/harness` | Agent, CLI, and automation-task integration |

The Skill defines how an Agent uses SoloPi, the Harness orchestrates tasks and acceptance, and the
Android APK observes and acts on the device. Using the Skill does not require embedding Python or a
model in the APK.

## Platform Support

| Platform | Current entry point and verified scope | Main prerequisites and limits |
|---|---|---|
| **Android** | SoloPi App, Desktop, and Harness; physical-device record/replay and selected read-only real-app flows have been verified | ADB, a compatible SoloPi build, and accessibility setup; compatibility varies by device and app |
| **iOS** | Desktop and Harness through WebDriverAgent; native test apps and selected read-only real-app flows have been verified on iPhone | A matching WDA build, Xcode signing, and device trust; navigation and node location have platform limits |
| **HarmonyOS NEXT** | Desktop and Harness through HDC and `uitest`; controlled native-app flows have been verified on an emulator | Current evidence is emulator-only; physical-device acceptance is pending and some input operations remain limited |

The platforms share selected control entry points and result semantics. This does **not** mean that
Android performance plugins, screen recording, or every device capability are available on iOS or
NEXT. See the [three-platform guide](solopi-desktop/docs/THREE_PLATFORM_CONTROL.md) and
[native regression guide](solopi-skill/references/native-regression-guide.md).

## Quick Start

### Option 1: Desktop Workbench

The full repository is the recommended starting point. For macOS Apple Silicon and an Android device:

1. Install Node.js, npm, Python 3.9+, and Android SDK Platform Tools. The Desktop documentation is verified with Node.js 22.14.0.
2. Enable USB debugging, authorize the computer, and install a SoloPi App version compatible with the current Harness.
3. Run from the repository root:

```bash
adb devices -l
cd solopi-desktop
npm ci
npm run dev
```

Select the device in Desktop and open **Three-platform device control** to inspect nodes, record, or
replay fixed cases. Desktop uses the adjacent `solopi-skill` directory and platform-specific device
tools; copying only `solopi-desktop/` is not sufficient for this workflow.

See the [Desktop README](solopi-desktop/README.md) and
[three-platform setup guide](solopi-desktop/docs/THREE_PLATFORM_CONTROL.md).

### Option 2: Skill / Harness

Use this path from a terminal or a Skill-capable Agent:

```bash
# List built-in workflows without connecting a device
./solopi-skill/scripts/solopi-ai --pretty workflow-list

# Check a prepared Android device and its permissions
./solopi-skill/scripts/solopi-ai --serial <device-serial> --pretty doctor

# Read the capabilities declared by that device
./solopi-skill/scripts/solopi-ai --serial <device-serial> --pretty capabilities
```

For standalone Skill installation, copy the entire `solopi-skill/` directory and preserve executable
permissions; do not copy `SKILL.md` alone. Read the [Skill](solopi-skill/SKILL.md) and
[built-in workflow](solopi-skill/references/workflows.md) documentation before running a device task.

Built-in real-app examples require specific initial pages and test accounts. The default path is
rule-based and does not require model weights. Use the returned `artifacts` path to inspect the
report from the same run.

### Option 3: Build the Android App

Use a compatible JDK and Android SDK with the project Gradle Wrapper:

```bash
./solopi-app/gradlew -p solopi-app :portal:assembleDebug
adb install -r solopi-app/portal/build/outputs/apk/debug/portal-debug.apk
```

An existing SoloPi installation with a different signature cannot be overwritten. Review its data
and signature before deciding how to proceed. Android system permissions must be completed on the
device. See the [Android documentation](solopi-app/README_eng.md) and
[troubleshooting guide](solopi-skill/references/troubleshooting.md).

## AI and Experimental Capabilities

| Capability | Current status |
|---|---|
| Agent page actions | Selects from bounded actions based on the current observation; rechecks the target before execution; final outcomes come from fixed checkpoints |
| Android virtual display | Experimental and off by default; requires Android 12+, a build with virtual-display and local-OCR support, and explicit activation in Desktop settings |
| Local Laya decisions | Optional experimental backend for selecting bounded candidates on the host; the default rule path does not require Laya |
| Visual-assisted selection | Controlled Android prototype; the pilot did not meet its preset benefit threshold, so rules remain the default |
| Message auto-reply | Limited to controlled test apps and fictional contacts; real WeChat auto-reply and a complete real-model image loop have not been verified |

Before enabling an external model or uploading an image, confirm that the model service and data
sharing boundary are appropriate. Experimental features do not guarantee higher speed or accuracy;
evaluate complete results on the actual device and scenario.

## Android Features

### Record and Replay

SoloPi records steps on an Android device for repeat execution and result checks. Available nodes
and actions depend on the target app and device.

![Android record and replay](solopi-app/assets/replay.gif)

### Performance Tools

Performance tools provide metric observation, collection, and selected stress scenarios. Metric
availability depends on the device and OS; video-difference response timing may require an optional plugin.

![Android performance tools](solopi-app/assets/performance.gif)

The original project introduced OneToMany device control, but that feature remains **closed source**
because of stability concerns. See the [Android README](solopi-app/README_eng.md) for details.

## Development and Validation

```bash
# Harness unit tests
python3 -m unittest discover -s solopi-skill/scripts/harness/tests -v

# Android unit tests and debug build
./solopi-app/gradlew -p solopi-app \
  :app:testDebugUnitTest :agentmodel:testDebugUnitTest :portal:assembleDebug
```

See the [Desktop README](solopi-desktop/README.md) for Desktop development, testing, and packaging.
Use authorized test environments for device, account, image, and log data. Review screenshots,
logs, and personal information before sharing a report. A single successful run does not establish
compatibility across all devices.

## Documentation

- [Android usage and features](solopi-app/README_eng.md)
- [Desktop workbench](solopi-desktop/README.md)
- [Three-platform device control](solopi-desktop/docs/THREE_PLATFORM_CONTROL.md)
- [Skill and Harness](solopi-skill/SKILL.md)
- [Verification plans and result adjudication](solopi-skill/references/verification-engine.md)
- [Managed execution and device pools](solopi-skill/references/managed-execution.md)
- [Troubleshooting](solopi-skill/references/troubleshooting.md)

## Community and Contributing

Use [Issues](https://github.com/alipay/SoloPi/issues), pull requests, or the
[SoloPi board on TesterHome](https://testerhome.com/topics/node152) to discuss problems and
improvements. Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

| DingTalk | WeChat |
|---|---|
| <img src="solopi-app/assets/dingtalk-group.png" width="200" alt="SoloPi DingTalk group" /> | <img src="solopi-app/assets/wechat-group.png" width="200" alt="SoloPi WeChat group" /> |

## License and Disclaimer

SoloPi is available under the [Apache License 2.0](LICENSE). Third-party components and assets retain
their own licenses and attribution requirements; see [NOTICE](NOTICE.md). Read the
[Disclaimer](Disclaimer.md) before use.
