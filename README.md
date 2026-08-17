# <img src="solopi-app/assets/icon.png" width="48" alt="SoloPi" /> SoloPi

[![GitHub stars](https://img.shields.io/github/stars/alipay/SoloPi.svg)](https://github.com/alipay/SoloPi)
[![GitHub license](https://img.shields.io/github/license/alipay/SoloPi.svg)](LICENSE)
[![Main app API](https://img.shields.io/badge/Main_App_API-18%2B-brightgreen.svg)](https://developer.android.com/guide/topics/manifest/uses-sdk-element)

SoloPi 是一套面向移动端研发的开源自动化与 AI Harness 工程。它保留了 SoloPi 在 Android
真机上的录制、回放、断言和性能诊断能力，并增加 Agent 接入、动态页面安全执行、独立结果
判定、无人值守托管和同次运行证据，让一次设备操作可以交付为可进入研发与 CI 流程的结论。

> 计划公开发行范围只包括 `solopi-app`、`solopi-harness-cli` 和 `solopi-skill`
> 三个产品模块，以及必要的根级文档与许可证文件。

## 开源模块

| 模块 | 定位 | 主要职责 |
|---|---|---|
| [`solopi-app/`](solopi-app/README.md) | 真机执行内核 | 录制回放、页面观察、触屏前复核、断言、性能与网络采集、动作回执；当前开源实现为 Android |
| [`solopi-harness-cli/`](solopi-harness-cli/README.md) | 宿主机责任中枢 | 类型化 CLI、设备协议、验证计划、结果判定器、单机托管、证据报告和可选模型生命周期 |
| [`solopi-skill/`](solopi-skill/SKILL.md) | Agent 使用入口 | 描述能力、核对输入、安全规则和结果口径，并把 Agent 请求路由到受控 CLI；不承载执行内核 |

被测 App 不需要接入 Agent SDK，也不需要因为使用 Harness 修改业务代码。

## 工作方式

```text
用户目标
   |
   v
支持 Skill 的 Agent
   |
   v
solopi-skill
   |  类型化任务与安全约束
   v
solopi-harness-cli
   |  ADB + 受控协议
   v
solopi-app  -------------------->  被测 App
   |                                  |
   `---------- 回执与证据 <-----------'
                    |
                    v
          passed / failed / not_tested
```

- Agent 可以提出下一步动作，但不能直接触屏，也不能直接判定测试通过。
- 动态动作绑定当前页面观察；页面已经变化时，旧动作会在真正执行前被拒绝。
- 验收目标、检查点、安全红线和结束恢复先形成测试合同，最终结果由确定性结果判定器独立裁决。
- 已提交的托管任务与 Worker 进程分离；可重试基础设施故障能产生新的执行尝试，旧 Worker 的迟到结果不能写回。
- 报告中的结论必须引用本次执行的检查点、动作回执、页面或时间线证据，不能跨执行尝试拼接。

## solopi-app：无线化、非侵入式 Android 自动化工具

> SoloPi 是一个无线化、非侵入式的 Android 自动化工具，公测版拥有录制回放、性能测试、
> 一机多控三项主要功能，能为测试开发人员节省宝贵时间。
>
> SoloPi 新增鸿蒙版本，欢迎大家试用，切到 `solopi-harmony` 分支。

### 功能特性

#### 录制回放

![录制回放](solopi-app/assets/replay.gif)

**[游戏录制回放使用视频](https://gw.alipayobjects.com/mdn/rms_e29b5f/afts/file/A*ym07T6nACDIAAAAAAAAAAABkARQnAQ)**

**[Native 应用录制回放使用视频](https://gw.alipayobjects.com/os/basement_prod/3472d35c-bd57-4c82-8112-5dcde42fcb32.mov)**

SoloPi 拥有录制操作的能力，用户只需要通过 SoloPi 执行用例步骤，SoloPi 就能够将用户的操作
记录下来，并且支持在各个设备上进行回放，这一切都能够在手机上独立完成。详见
[录制回放](#录制回放)。

SoloPi JSON 可以转化为其他自动化脚本，目前支持 Appium 和 Macaca，可以前往
[SoloPi-Convertor](https://github.com/soloPi/SoloPi-Convertor) 下载体验。

#### 性能工具

![性能工具](solopi-app/assets/performance.gif)

**[性能工具使用视频](https://gw.alipayobjects.com/os/basement_prod/1996390b-9ec8-4046-8ce8-459afa05d6c5.mov)**

**[响应耗时计算使用视频](https://gw.alipayobjects.com/os/basement_prod/4e82ca85-13fc-4de2-82ff-a9079344f5ef.mov)**

SoloPi 能够记录待测应用的各项指标，你可以在悬浮窗中观察实时更新的数据，也可以对性能数据
进行录制，在录制结束后查看图表；同时，SoloPi 还支持性能加压，能够对 CPU、内存与网络环境
进行限制，复现应用在性能较差、网络环境不佳场景下的表现。

除了常规性能指标，SoloPi 还提供了启动耗时计算工具，测试同学只需要点击两次按钮，就可以
得到最贴近用户体验的启动耗时数据。同时，启动耗时计算工具还可以通过广播调用，可以非常方便
地与 UI 自动化测试打通。详见[性能工具](#性能工具)。

#### 一机多控

![一机多控](solopi-app/assets/oneToMany.gif)

**[一机多控使用视频](https://gw.alipayobjects.com/os/basement_prod/971b5467-3db0-4781-86e3-15b3907323f6.mov)**

SoloPi 支持通过操作一台主机设备来控制多台从机设备，不需要在各个设备上分别进行重复冗杂的
兼容性测试，能够极大提升兼容性测试的效率。详见
[一机多控](#一机多控)。

### 构建

> 开源部分包含录制回放与性能测试工具，一机多控功能由于稳定性原因暂时还没有开源，后续会继续推进。

#### 编译环境

- macOS 10.14.3
- Android Studio 4.0
- Gradle 6.1.1
- CMake 3.6/3.10 均可
- NDK 16
- TargetApi 29
- MinimumApi 18
- **注意：构建时请将 Android Studio 的 Instant Run 功能关闭，否则打出的安装包可能无法使用。**

### solopi-app 快速开始

#### 下载并配置 Android SDK 路径

前往 [SDK Platform Tools](https://developer.android.com/studio/releases/platform-tools#downloads)
下载对应系统版本，解压后在系统环境变量中添加 `ANDROID_SDK=${SDK 解压路径}`。也可以参考
[ADB 配置文档](https://sspai.com/post/40471)。

> Windows 10 以上配置完环境变量后可在新开的命令行中生效；较老 Windows 系统可能需要重启。
> Linux 和 macOS 可通过 `echo $ANDROID_SDK` 检验是否生效。

#### 开启手机开发者模式

打开手机设置应用，在“关于手机 → 软件信息”菜单下连续点击“编译编号”7 次，系统会提示已进入
开发者模式。回到设置应用根页面，进入“开发者选项”，开启“USB 调试”。

#### 常见问题

如果使用过程中遇到问题，可以先到[常见问题](#常见问题)查找。

- VIVO：如果开发者选项中包含“USB 安全操作”，需要手动开启；
- 小米：需要开启“USB 安装”和“USB 调试（安全设置）”，并手动开启 SoloPi 的“后台弹出界面”；
- 魅族：如果待测应用属于支付、金融类应用，需要在手机管家中关闭安全支付功能；
- 华为：需要开启“仅充电模式下允许 ADB 调试”；
- OPPO：系统可能每 10 分钟自动断开 USB 调试，如需保持稳定应连接电脑；
- 如果设备有安全输入法，请在系统设置中关闭安全输入法，否则部分输入框可能无法正常输入。

#### 连接设备并开启 Wi-Fi 调试端口

先连接设备到电脑，并通过以下命令检查连接。设备会提示“是否允许 USB 调试”，请选择确定。

Windows：

```bat
%ANDROID_SDK%\platform-tools\adb.exe devices
```

macOS 或 Linux：

```bash
$ANDROID_SDK/platform-tools/adb devices
```

如果命令行显示出设备号且状态为 `device`，表示连接成功。

![建立连接](https://raw.githubusercontent.com/wiki/alipay/SoloPi/FirstUse/genConnection.png)

> Windows 需要安装 Android 设备驱动，可以从手机厂商官网下载；如果设备状态不是 `device`，
> 请确认已安装驱动、允许 USB 调试，必要时将 USB 连接模式改为“传输图片（MTP）”。

单机场景：

```bat
%ANDROID_SDK%\platform-tools\adb.exe tcpip 5555
```

```bash
$ANDROID_SDK/platform-tools/adb tcpip 5555
```

多机场景需要先记录设备序列号：

```bat
%ANDROID_SDK%\platform-tools\adb.exe -s <设备序列号> tcpip 5555
```

```bash
$ANDROID_SDK/platform-tools/adb -s <设备序列号> tcpip 5555
```

通常设备会显示 `restarting in TCP mode port: 5555`，表示已开启无线 ADB 调试模式。

> 请确保设备处于安全的网络环境，不要随意允许 ADB 调试请求，以免造成不必要的损失。

可以从 [GitHub Releases](https://github.com/alipay/SoloPi/releases/latest) 下载打包好的 SoloPi APK，
或克隆源码后自行编译。具体使用方式参见[solopi-app 快速开始](#solopi-app-快速开始)。

### solopi-app 文档

- [第一次使用与注意事项](#solopi-app-快速开始)
- [solopi-app 完整文档](solopi-app/README.md)

## 主要能力

### 固定自动化

- 真机录制、用例编辑、导入导出；
- 点击、输入、滚动、返回、节点与图片断言；
- 单次、重复和批量回放；
- 不可变用例快照、运行标识和结果证据。

### 动态 Agent 执行

- 当前页面 Observation 与页面结构摘要；
- 7 类类型化动态动作；
- 触屏前重新观察、节点重新定位和旧页面拒绝；
- 动作幂等回执、时间线、步骤和时长预算。

### 验证与可信报告

- 结构化需求、验收条件和测试计划；
- 检查点、确定性预期规则和 required Cleanup；
- 独立 Result Judge；
- `passed`、`failed`、`not_tested` 三态结果及证据引用。

### 无人值守托管

- 持久化任务、设备分片和执行尝试；
- 设备匹配、lease、heartbeat 和有界重试；
- Worker 接管与旧归属写入隔离；
- 单主机多 Worker 和 CI 可消费报告。

### 性能与工程工具

- CPU、内存、FPS/Jank、电池、温度、进程与网络流量采集；
- 冷启动、暖启动和多轮启动耗时；
- 录屏、视觉响应分析、截图与日志；
- 有界 CPU/内存压力；
- 可选端侧模型签名、安装、基准、激活和回滚。

具体指标以目标设备实际返回为准；端侧模型是可选增强，不是使用 Harness 的前提。

## 三个开源模块快速开始

### 环境要求

- macOS 或 Linux；
- Python 3.9 或更高版本；
- Android SDK 与可执行的 `adb`；
- 构建 `solopi-app` 使用 JDK 11；
- 一台已授权用于测试的 Android 设备。

### 1. 构建并安装 solopi-app

```bash
./solopi-app/gradlew -p solopi-app \
  :app:testDebugUnitTest \
  :agentmodel:testDebugUnitTest \
  :portal:assembleDebug

adb install -r solopi-app/portal/build/outputs/apk/debug/portal-debug.apk
```

辅助功能、悬浮窗、电池优化白名单和必要权限需要由用户在设备上确认，工具不会静默授权。

### 2. 使用 CLI

直接使用源码入口：

```bash
./solopi-harness-cli/solopi-ai --pretty actions
./solopi-harness-cli/solopi-ai --pretty doctor
```

也可以在虚拟环境中安装：

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e ./solopi-harness-cli
solopi-ai --pretty actions
```

`actions`、用例模板和验证计划编译等纯本地命令不需要设备；涉及真机协议的操作应先运行
`doctor`，并根据返回的就绪缺口完成设置。

### 3. 通过 Agent Skill 调用

`solopi-skill` 是面向支持 Skill 的 Agent 的规则入口。它会调用同仓的 CLI：

```bash
./solopi-skill/scripts/solopi-ai --pretty doctor
./solopi-skill/scripts/solopi-ai --pretty capabilities
```

使用前请完整阅读 [`solopi-skill/SKILL.md`](solopi-skill/SKILL.md)。自然语言由 Agent
结合 Skill 规则解释；Skill 本身不是大模型，也不会绕过 CLI 和设备端安全边界。

## 本地验证

公开源码的基础门禁只依赖这三个模块：

```bash
python3 -m unittest discover -s solopi-harness-cli/tests -v
./solopi-skill/scripts/solopi-ai --pretty actions
./solopi-app/gradlew -p solopi-app \
  :app:testDebugUnitTest \
  :agentmodel:testDebugUnitTest \
  :portal:assembleDebug
```

真机测试会读取页面、截图、日志和性能数据。请使用专用测试设备与测试账号，不要在生产账号、
真实支付环境或未获授权的应用上运行。

## solopi-app 代码导读

- `app`：应用业务逻辑；
- `shared`：应用核心功能，主要包含 node（页面节点获取操作）、event（各类事件监控获取，
  包含辅助功能事件、触摸事件）、io（数据维护、数据库）、display（性能工具监控项）；
- `common`：应用框架功能，包含 ADB 能力包装、全局 Service 能力、消息模块与常用工具；
- `mdlibrary`：ExportService 对应的 Proxy 生成（引用）；
- `permission`：权限处理包（引用）；
- `AdbLib`：ADB 连接处理（引用）；
- `androidWebscokets`：Android 实现的 WebSocket（引用）。

## 内容讨论

面向行业测试相关从业人员，如果对工具有意见或建议，欢迎通过 Issue、PR 或社群讨论。

- 钉钉群（三群）：

![SoloPi 体验与交流群（三群）](solopi-app/assets/dingtalk-group.png)

- 微信群（SoloPi 体验与交流群 2.0）：

![SoloPi 体验与交流群 2.0](solopi-app/assets/wechat-group.png)

- 也可以在 [TesterHome SoloPi 板块](https://testerhome.com/topics/node152)留言。

## 贡献

SoloPi 需要开发者们的共建，也希望能在开发者的支持下更好地发展。如果你基于 SoloPi 开发出
了更贴近业务场景的能力（商业或非商业），欢迎联系我们，也希望能主动为开源出力，提交各种
features、bugfix 和 issue，共同维护 SoloPi 这套自动化工具。

### 如何贡献

[代码贡献](CONTRIBUTING.md)：SoloPi 开发参与说明书。

独乐乐不如众乐乐，开源的核心还是技术分享。当你对开源项目产生想法时，也可以有更加 Smart
的表达方式：

- 我们的业务需要这项功能 → 我加了一个可以用于很多场景的功能，已经提交 MR；
- 这块有更详细的文档吗 → 我调整了文档，使它更方便使用，请帮忙合并；
- 我在某款手机上无法使用 → 我修复了该设备上的兼容问题；
- 功能和文档不一致 → 我整理了踩坑记录，并补充了文档；
- 这个项目是否持续维护 → 我能做些什么？

Star、Fork、Merge Request 和 Issue 随时欢迎使用。如果你有好的想法，也欢迎直接联系并深入
讨论，一起推动这套移动端测试工具框架的发展。

## 致谢

开发过程中使用了一些第三方库，相关信息见[版权信息](NOTICE.md)。

## 当前边界

- 当前设备端开源实现为 Android；
- Managed Execution 是单主机 SQLite WAL 控制面，支持同主机多 Worker，不是云真机供给、
  多主机高可用或企业 Web 管理平台；
- 动态 Agent 面向可信工作站、受控测试设备和明确的任务范围；
- 插件包含可在 App 进程中运行的动态代码，只应安装来源明确且经过授权的本地包；
- `done` 只是 Agent 的停止信号，正式结论始终来自 Result Judge；
- 可信交付不等于所有任务都通过，无法可靠观察或缺少证据时应返回 `not_tested`。

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。提交第三方代码、模型、图片或二进制前，必须提供
准确来源、版本、许可证和修改说明。

## 许可证

SoloPi 以 [Apache License 2.0](LICENSE) 开源。第三方组件继续适用各自的许可证和归属要求。

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

## Disclaimer（免责声明）

[免责声明](Disclaimer.md)
