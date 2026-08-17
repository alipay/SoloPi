# <img src="solopi-app/assets/icon.png" width="48" alt="SoloPi" /> SoloPi

[![GitHub stars](https://img.shields.io/github/stars/alipay/SoloPi.svg)](https://github.com/alipay/SoloPi/stargazers)
[![GitHub license](https://img.shields.io/github/license/alipay/SoloPi.svg)](LICENSE)
[![Main app API](https://img.shields.io/badge/Main_App_API-18%2B-brightgreen.svg)](https://developer.android.com/guide/topics/manifest/uses-sdk-element)

SoloPi is an open-source automation and AI Harness project for mobile development. It preserves
SoloPi's recording, replay, assertion, and performance-diagnostic capabilities on physical Android
devices, while adding Agent integration, safe execution on dynamic pages, independent result
adjudication, unattended managed execution, and same-run evidence. This turns a device interaction
into a conclusion that can be delivered into development and CI workflows.

> The planned public distribution includes only the three product modules `solopi-app`,
> `solopi-harness-cli`, and `solopi-skill`, together with the necessary root-level documentation
> and license files.

## Open-source Modules

| Module | Role | Primary responsibilities |
|---|---|---|
| [`solopi-app/`](solopi-app/README_eng.md) | Physical-device execution kernel | Recording and replay, page observation, pre-touch verification, assertions, performance and network collection, and action receipts; the current open-source implementation is for Android |
| [`solopi-harness-cli/`](solopi-harness-cli/README.md) | Host-side responsibility center | Typed CLI, device protocol, verification plans, result judge, single-host managed execution, evidence reports, and an optional model lifecycle |
| [`solopi-skill/`](solopi-skill/SKILL.md) | Agent entry point | Describes capabilities, validates input, defines safety rules and result semantics, and routes Agent requests to the controlled CLI; it does not contain the execution kernel |

The app under test does not need to integrate an Agent SDK or change its business code in order to
use the Harness.

## How It Works

```text
User goal
   |
   v
Skill-capable Agent
   |
   v
solopi-skill
   |  Typed tasks and safety constraints
   v
solopi-harness-cli
   |  ADB + controlled protocol
   v
solopi-app  -------------------->  App under test
   |                                  |
   `---------- Receipts and evidence <-'
                    |
                    v
          passed / failed / not_tested
```

- An Agent may propose the next action, but it cannot touch the screen directly or declare that a
  test has passed.
- Dynamic actions are bound to the current page observation. If the page has changed, the stale
  action is rejected before any real interaction occurs.
- Acceptance goals, checkpoints, safety boundaries, and final recovery are first captured in a test
  contract. The final outcome is independently decided by a deterministic Result Judge.
- Submitted managed jobs are separated from Worker processes. A retryable infrastructure failure
  can create a new execution attempt, and a late result from an old Worker cannot be written back.
- Every conclusion in a report must cite checkpoints, action receipts, page evidence, or timeline
  evidence from the same execution attempt. Evidence cannot be combined across attempts.

## solopi-app: A Wireless, Non-invasive Android Automation Tool

> SoloPi is a wireless, non-invasive testing tool for automatic Android software testing. The Beta
> version has 3 main features: record and replay, performance testing, multi-device compatibility
> testing (OneToMany).
>
> SoloPi also has a HarmonyOS version. To try it, switch to the `solopi-harmony` branch.

### Features

#### Record and Replay

![Recording playback](solopi-app/assets/replay.gif)

**[Record the testing on a mobile game.](https://gw.alipayobjects.com/mdn/rms_e29b5f/afts/file/A*ym07T6nACDIAAAAAAAAAAABkARQnAQ)**

**[Record the testing on a native phone app.](https://gw.alipayobjects.com/os/basement_prod/3472d35c-bd57-4c82-8112-5dcde42fcb32.mov)**

SoloPi captures all actions performed during testing sessions so that issues can be identified and
resolved more quickly. The recording can be played on any device. All these actions can be done on
just one single phone. See [Record and Replay](#record-and-replay).

SoloPi JSON can be converted into other automation scripts. Appium and Macaca are currently
supported; download and try [SoloPi-Convertor](https://github.com/soloPi/SoloPi-Convertor).

#### Performance Testing

![Performance analysis](solopi-app/assets/performance.gif)

**[Use the performance analysis function](https://gw.alipayobjects.com/os/basement_prod/1996390b-9ec8-4046-8ce8-459afa05d6c5.mov)**

**[Use the launch time calculator](https://gw.alipayobjects.com/os/basement_prod/4e82ca85-13fc-4de2-82ff-a9079344f5ef.mov)**

SoloPi is able to record and show the app's performance data, such as CPU, memory, and internet
speed, while testing. The performance window with selected testing metrics will float on top. After
testing, you can check each testing parameter in generated data graphs.

SoloPi can also change the testing environment to simulate certain situations. For instance, it can
slow down the internet speed to simulate using the app with a poor network connection.

SoloPi also adds a function to calculate app launch time. This tool shows the actual launch time to
the greatest extent possible. The calculator can be incorporated into UI automation tests by
sending broadcast messages. See [Performance Testing](#performance-testing).

#### Multi-device Compatibility Testing

![Multi-device testing](solopi-app/assets/oneToMany.gif)

**[Simultaneous multi-device testing](https://gw.alipayobjects.com/os/basement_prod/971b5467-3db0-4781-86e3-15b3907323f6.mov)**

SoloPi supports simultaneous multi-device compatibility testing controlled by one device. This
enormously improves the efficiency of testing on different devices. See
[Multi-device Compatibility Testing](#multi-device-compatibility-testing).

### Build

> Open-source SoloPi excludes the multi-device compatibility testing feature because it is still
> unstable. Work on opening this feature will continue.

#### Build Environment

- macOS 10.14.3
- Android Studio 3.2
- **Gradle 4.4 (upgrading is not recommended)**
- **CMake 3.6.4111459 (upgrading is not recommended)**
- NDK 15.2.4203819
- TargetApi 25
- MinimumApi 18
- **Note: Turn off Instant Run in Android Studio. Otherwise, the app does not work.**

### solopi-app Quick Start

#### Download and Configure the Android SDK Path

Download the appropriate [SDK Platform Tools](https://developer.android.com/studio/releases/platform-tools#downloads),
unzip them, and add `ANDROID_SDK=${SDK path}` to your system environment variables. You can also
refer to an [ADB configuration guide](https://sspai.com/post/40471).

> On Windows 10 and later, the environment variable takes effect in a newly opened command prompt.
> Older Windows versions may need to be restarted. On Linux and macOS, run `echo $ANDROID_SDK` to
> verify the setting.

#### Enable Developer Mode on the Device

Open the Settings app. Under "About phone -> Software information," tap "Build number" seven times.
The system will indicate that developer mode has been enabled. Return to the Settings home page,
open "Developer options," and enable "USB debugging."

#### Known Issues

If you encounter a problem, first check [Known Issues](#known-issues).

- On VIVO devices, if Developer options contains an option such as "USB security access," it must
  be enabled manually.
- On Xiaomi devices, enable "USB installation" and "USB debugging (Security settings)." You also
  need to enable SoloPi's "后台弹出界面" permission.
- On MEIZU devices, if the app under test contains highly secured functions such as payments,
  disable the system's secure-payment function.
- On HUAWEI devices, enable "Allow ADB debugging in charge only mode."
- On OPPO devices, the system may disable USB debugging every ten minutes. Keep the phone connected
  to the computer for a stable connection.
- If the device has a secure input method, disable it in system settings; otherwise, text may not be
  entered correctly in some fields.

#### Connect the Device and Enable the Wi-Fi Debugging Port

First connect the device to the computer and verify the connection with the following command. The
device will ask whether to allow USB debugging; confirm the request.

Windows:

```bat
%ANDROID_SDK%\platform-tools\adb.exe devices
```

macOS or Linux:

```bash
$ANDROID_SDK/platform-tools/adb devices
```

If the command lists a device serial number with the status `device`, the connection is successful.

![Establishing a connection](https://raw.githubusercontent.com/wiki/alipay/SoloPi/FirstUse/genConnection.png)

> Windows may require an Android device driver, which can be downloaded from the device vendor's
> website. If the device status is not `device`, verify that the driver is installed and USB
> debugging is allowed. If necessary, change the USB connection mode to "Media Transfer Protocol
> (MTP)."

For a single device:

```bat
%ANDROID_SDK%\platform-tools\adb.exe tcpip 5555
```

```bash
$ANDROID_SDK/platform-tools/adb tcpip 5555
```

For multiple devices, first record each device serial number:

```bat
%ANDROID_SDK%\platform-tools\adb.exe -s <device-serial-number> tcpip 5555
```

```bash
$ANDROID_SDK/platform-tools/adb -s <device-serial-number> tcpip 5555
```

The device will usually display `restarting in TCP mode port: 5555`, indicating that wireless ADB
debugging has been enabled.

> Make sure the device is on a secure network. Do not accept ADB debugging requests casually, as
> doing so may cause unnecessary loss.

Download a packaged SoloPi APK from [GitHub Releases](https://github.com/alipay/SoloPi/releases), or
clone the source and build it yourself. See [solopi-app Quick Start](#solopi-app-quick-start)
for detailed instructions.

### solopi-app Documentation

- [First Use and Notes](#solopi-app-quick-start)
- [Full solopi-app Documentation](solopi-app/README_eng.md)

## Major Capabilities

### Fixed Automation

- Physical-device recording, case editing, import, and export
- Click, input, scroll, back, node assertions, and image assertions
- Single, repeated, and batch replay
- Immutable case snapshots, run identities, and result evidence

### Dynamic Agent Execution

- Current-page Observation and page-structure summary
- Seven categories of typed dynamic actions
- Re-observation before a touch, node relocation, and stale-page rejection
- Idempotent action receipts, timelines, step budgets, and duration budgets

### Verification and Trustworthy Reports

- Structured requirements, acceptance criteria, and test plans
- Checkpoints, deterministic oracle rules, and required Cleanup
- An independent Result Judge
- Three-state `passed`, `failed`, and `not_tested` outcomes with evidence references

### Unattended Managed Execution

- Persistent jobs, device shards, and execution attempts
- Device matching, leases, heartbeats, and bounded retries
- Worker takeover and isolation from writes by a previous owner
- Multiple Workers on one host and CI-consumable reports

### Performance and Engineering Tools

- CPU, memory, FPS/Jank, battery, temperature, process, and network-traffic collection
- Cold-start, warm-start, and multi-round launch timing
- Screen recording, visual response analysis, screenshots, and logs
- Bounded CPU and memory stress
- Optional on-device model signing, installation, benchmarking, activation, and rollback

Specific metrics depend on what the target device actually returns. An on-device model is an
optional enhancement, not a prerequisite for using the Harness.

## Quick Start for the Three Open-source Modules

### Requirements

- macOS or Linux
- Python 3.9 or later
- Android SDK with an executable `adb`
- JDK 11 to build `solopi-app`
- An Android device authorized for testing

### 1. Build and Install solopi-app

```bash
./solopi-app/gradlew -p solopi-app \
  :app:testDebugUnitTest \
  :agentmodel:testDebugUnitTest \
  :portal:assembleDebug

adb install -r solopi-app/portal/build/outputs/apk/debug/portal-debug.apk
```

Accessibility, display-over-other-apps permission, battery-optimization allowlisting, and other
required permissions must be confirmed by the user on the device. The tool does not grant them
silently.

### 2. Use the CLI

Run the source entry point directly:

```bash
./solopi-harness-cli/solopi-ai --pretty actions
./solopi-harness-cli/solopi-ai --pretty doctor
```

Alternatively, install it in a virtual environment:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e ./solopi-harness-cli
solopi-ai --pretty actions
```

Purely local commands such as `actions`, case templates, and verification-plan compilation do not
require a device. Before using a physical-device protocol operation, run `doctor` and resolve the
readiness gaps it reports.

### 3. Invoke It Through the Agent Skill

`solopi-skill` is the rules entry point for Skill-capable Agents. It invokes the CLI in the same
repository:

```bash
./solopi-skill/scripts/solopi-ai --pretty doctor
./solopi-skill/scripts/solopi-ai --pretty capabilities
```

Read [`solopi-skill/SKILL.md`](solopi-skill/SKILL.md) in full before use. Natural language is
interpreted by the Agent according to the Skill rules. The Skill itself is not a large language
model, and it does not bypass the CLI or the device-side safety boundaries.

## Local Verification

The basic gate for the public source depends only on these three modules:

```bash
python3 -m unittest discover -s solopi-harness-cli/tests -v
./solopi-skill/scripts/solopi-ai --pretty actions
./solopi-app/gradlew -p solopi-app \
  :app:testDebugUnitTest \
  :agentmodel:testDebugUnitTest \
  :portal:assembleDebug
```

Physical-device tests read pages, screenshots, logs, and performance data. Use a dedicated test
device and test account. Do not run them with production accounts, in a real payment environment,
or against an app you are not authorized to test.

## solopi-app Code Guide

- `app`: application business logic
- `shared`: core application functions, primarily including node (page-node acquisition and
  operations), event (event monitoring, including accessibility and touch events), io (data
  maintenance and database), and display (performance-tool metrics)
- `common`: application-framework functions, including wrappers for ADB capabilities, global
  Service capabilities, the messaging module, and common utilities
- `mdlibrary`: Proxy generation for ExportService (referenced)
- `permission`: permission-handling package (referenced)
- `AdbLib`: ADB connection handling (referenced)
- `androidWebscokets`: WebSocket implementation for Android (referenced)

## Community

SoloPi is intended for professionals working in software testing. If you have feedback or
suggestions, you are welcome to discuss them through Issues, PRs, or the community.

- DingTalk group 3:

![SoloPi Experience and Community Group 3](solopi-app/assets/dingtalk-group.png)

- WeChat group (SoloPi Experience and Community Group 2.0):

![SoloPi Experience and Community Group 2.0](solopi-app/assets/wechat-group.png)

- You can also leave a message in the [TesterHome SoloPi forum](https://testerhome.com/topics/node152).

## Contributing

SoloPi needs developers to build it together and hopes to grow with their support. If you have
developed a capability based on SoloPi that better fits a business scenario, whether commercial or
non-commercial, please contact us. We also hope you will contribute features, bug fixes, and Issues
and help maintain the SoloPi automation tool.

### How to Contribute

See [Contributing Code](CONTRIBUTING.md), the guide for participating in SoloPi development.

The heart of open source is sharing technology. When you have an idea about the project, you can
express it in a more constructive way:

- "Our business needs this feature" -> "I added a feature that can be used in many scenarios and
  submitted an MR."
- "Is there more detailed documentation?" -> "I revised the documentation to make it easier to use;
  please help merge it."
- "I cannot use it on this phone" -> "I fixed a compatibility issue on this device."
- "The behavior does not match the documentation" -> "I documented the pitfalls and supplemented
  the documentation."
- "Is this project still maintained?" -> "What can I do?"

Stars, forks, Merge Requests, and Issues are always welcome. If you have a good idea, please contact
us for a deeper discussion and help move this mobile-testing framework forward.

## Attributions

The project uses third-party libraries. See [Attributions](NOTICE.md) for details.

## Current Scope

- The current open-source device-side implementation is for Android.
- Managed Execution is a single-host SQLite WAL control plane that supports multiple Workers on the
  same host. It is not a cloud-device supply service, a multi-host high-availability system, or an
  enterprise web-management platform.
- Dynamic Agents are intended for trusted workstations, controlled test devices, and clearly scoped
  tasks.
- Plugins contain dynamic code that can run in the app process. Install only authorized local
  packages from known sources.
- `done` is only the Agent's stop signal. The formal conclusion always comes from the Result Judge.
- Trustworthy delivery does not mean that every task passes. Return `not_tested` when the result
  cannot be observed reliably or when evidence is missing.

## Contributing to the Project

Read [CONTRIBUTING.md](CONTRIBUTING.md). Before submitting third-party code, models, images, or
binaries, provide the exact source, version, license, and a description of your changes.

## License

SoloPi is open source under the [Apache License 2.0](LICENSE). Third-party components remain subject
to their respective license and attribution requirements.

```text
Copyright (C) 2015-present, Ant Financial Services Group

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## Disclaimer

[Disclaimer](Disclaimer.md)
