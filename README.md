# <img src="solopi-app/assets/icon.png" width="48" alt="SoloPi" /> SoloPi

[![GitHub stars](https://img.shields.io/github/stars/alipay/SoloPi.svg)](https://github.com/alipay/SoloPi)
[![License](https://img.shields.io/github/license/alipay/SoloPi.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/alipay/SoloPi)](https://github.com/alipay/SoloPi/releases/latest)

[官方网站](https://www.solopi.cn/) · [下载 APK](https://github.com/alipay/SoloPi/releases/latest) · [English](README_eng.md) · [反馈问题](https://github.com/alipay/SoloPi/issues) · [参与贡献](CONTRIBUTING.md)

**面向移动设备的开源自动化测试工具：从真机操作到可复核的测试结论。**

SoloPi 提供 Android 录制回放与性能工具，也提供桌面工作台和面向 AI Agent 的 Skill / Harness。你可以在电脑上观察设备、录制并回放用例，或让 Agent 在明确的动作范围内协助执行；最终结果由预先定义的检查条件和本次运行证据决定。

被测应用通常无需接入 SoloPi SDK。不同系统、设备与页面的能力和限制，请先查看下方[平台支持](#平台支持)。

## 你可以用 SoloPi 做什么

- **录制与回放**：在 Android 上记录操作并重复执行；也可以通过桌面节点控制录制、编辑和回放固定用例。
- **观察与验证**：查看当前页面、选择可定位节点、设置固定检查点，并保留动作回执、截图及测试结果。
- **性能诊断**：按设备能力采集 CPU、内存、帧率、电池、温度等指标，结合日志、录屏和启动耗时排查问题。
- **Agent 协作**：使用 Skill 和 Harness，将自然语言任务转化为受约束的观察与执行步骤；Agent 的完成声明不替代验收。
- **自动化集成**：通过 CLI 执行用例、读取结构化报告；托管执行支持单主机设备队列、租约与有界重试。

### 从设备操作到测试结论

```text
桌面操作 / Agent 任务 / CLI
             │
             ▼
     SoloPi Skill + Harness
   计划、设备会话、回执与证据
             │
             ▼
 Android SoloPi / iOS WDA / NEXT 驱动
             │
             ▼
      页面观察 → 受约束动作
             │
             ▼
   固定检查点 + 独立结果判定
             │
             ▼
     passed / failed / not_tested
```

`passed` 表示必需检查点和清理条件通过；`failed` 表示已确认结果不符合预期；`not_tested` 表示证据不足，无法判定。动作结果不明时不应盲目重发。

## 仓库结构

| 目录 | 内容 | 适合谁 |
| --- | --- | --- |
| [`solopi-app/`](solopi-app/README.md) | Android 应用、录制回放、性能工具及设备执行能力 | 直接使用或开发手机端能力 |
| [`solopi-desktop/`](solopi-desktop/README.md) | Electron 桌面工作台、设备控制、用例编排与报告 | 希望通过图形界面操作设备和管理测试 |
| [`solopi-skill/`](solopi-skill/SKILL.md) | Agent 使用规则和内置 Harness（`scripts/harness`） | 希望从 Agent、CLI 或自动化任务调用 |

Skill、Harness 和 Android APK 各司其职：Skill 提供 Agent 使用规则，Harness 编排任务和验收，APK 在 Android 设备上采集与执行。使用 Skill 不要求把 Python 或模型打进 APK。

## 平台支持

| 平台 | 当前入口与已验证范围 | 主要前提与限制 |
| --- | --- | --- |
| **Android** | SoloPi App、Desktop 和 Harness；真机已验证录制回放及特定真实 App 只读流程 | ADB、配套 SoloPi、设备辅助功能；设备和应用兼容性需分别验证 |
| **iOS** | Desktop / Harness 通过 WebDriverAgent 控制；已验证 iPhone 上的原生测试应用与特定真实 App 只读流程 | 需要匹配设备的 WDA、Xcode 签名和设备信任；返回和节点定位有平台限制 |
| **HarmonyOS NEXT** | Desktop / Harness 通过 HDC 和 `uitest` 控制；已验证模拟器上的受控原生应用流程 | 当前以模拟器为限，真机尚未验收；输入等操作有明确限制 |

三端共用部分控制入口和结果语义，**不代表 Android 的性能插件、录屏或全部设备能力已移植到 iOS / NEXT**。平台准备、动作限制和验证范围见[三端设备控制指南](solopi-desktop/docs/THREE_PLATFORM_CONTROL.md)及[原生回归指南](solopi-skill/references/native-regression-guide.md)。

## 快速开始

### 方式一：使用桌面工作台

推荐从完整仓库启动。以 macOS Apple Silicon 和 Android 设备为例：

1. 安装 Node.js、npm、Python 3.9+ 和 Android SDK Platform-Tools，确保终端可以执行 `adb`。桌面文档使用 Node.js 22.14.0 验证，其他版本请自行核对兼容性。
2. 在 Android 设备上开启 USB 调试并授权当前电脑，安装与当前 Harness 协议匹配的 SoloPi App；首次使用时按设备提示完成初始化和辅助功能设置。
3. 在仓库根目录执行：

```bash
adb devices -l
cd solopi-desktop
npm ci
npm run dev
```

设备状态应为 `device`。桌面启动后，选择设备；需要节点录制和固定回放时，打开左侧的「三端设备控制」。桌面同时需要相邻的 `solopi-skill` 和所选平台的设备工具，不能只复制 `solopi-desktop/` 使用该入口。

首次连接、iOS WDA / NEXT HDC 准备、录制和回放步骤见[桌面三端指南](solopi-desktop/docs/THREE_PLATFORM_CONTROL.md)。桌面的其他用例编排和 CLI 用法见 [Desktop README](solopi-desktop/README.md)。

### 方式二：使用 Skill / Harness

适合从终端或支持 Skill 的 Agent 发起任务。以下命令在仓库根目录运行：

```bash
# 查看本地内置工作流，不需要连接设备
./solopi-skill/scripts/solopi-ai --pretty workflow-list

# 连接已初始化的 Android 设备后，检查配套 App 和权限
./solopi-skill/scripts/solopi-ai --serial <设备序列号> --pretty doctor

# 查询设备声明的能力
./solopi-skill/scripts/solopi-ai --serial <设备序列号> --pretty capabilities
```

需要作为独立 Skill 安装时，请完整复制 `solopi-skill/` 目录到使用的 Agent 所支持的 Skill 目录，保留脚本执行权限；不要只复制 `SKILL.md`。运行前阅读 [Skill 说明](solopi-skill/SKILL.md)和[内置工作流](solopi-skill/references/workflows.md)。

仓库提供需要特定初始页面的只读示例。确认测试账号、应用和初态符合要求后，可以从 `workflow-list` 选择模板；运行结束后，使用输出中的 `artifacts` 查看同一次运行报告。默认使用规则，不需要模型权重。

### 方式三：构建 Android App

需要 Android SDK 和项目兼容的 JDK。下面使用项目 Gradle Wrapper 构建调试包：

```bash
./solopi-app/gradlew -p solopi-app :portal:assembleDebug
adb install -r solopi-app/portal/build/outputs/apk/debug/portal-debug.apk
```

若设备上已有不同签名的 SoloPi，覆盖安装会失败；请先确认数据和签名，再决定如何处理。应用首次启动、系统辅助功能等授权需要在设备上完成。电脑端模式以 `doctor` 输出为准：支持 host profile 的版本通常不强制悬浮窗或电池优化白名单；手机端浮窗或录制等功能仍可能需要相应权限。完整构建与常见问题见 [Android 使用说明](solopi-app/README.md)和[故障处理](solopi-skill/references/troubleshooting.md)。

## AI 与实验能力

| 能力 | 当前状态 |
| --- | --- |
| Agent 页面操作 | 根据当前观察选择有限动作；执行前复核目标，最终结果由固定检查点独立判定 |
| Android 后台屏幕 | 实验功能，默认关闭；需要 Android 12+ 和包含副屏及本地 OCR 的实验构建，在「设置中心 → Agent 请求与屏幕」中启用。详情见[后台屏幕说明](solopi-desktop/docs/android-virtual-agent.md) |
| Laya 本地决策 | 可选实验后端，在电脑端选择有限候选；权重和运行环境需另行准备。默认规则模式无需 Laya，不应将规则链路的优化归因于模型 |
| 视觉辅助选择 | Android 受控场景原型；受控 pilot 曾出现误点，尚未达到预设收益门槛，默认继续使用规则。详见[实验说明](solopi-skill/references/vision-regression.md) |
| 消息自动回复 | 仅支持受控测试应用和虚构联系人；真机已验证合成文字、图片及模拟模型流程，真实模型图片闭环和真实微信自动回复尚未验证。当前只有一份角色说明和共享本地知识库，不支持多 Agent 角色配置 |

启用外部模型或上传图片前，请自行确认模型服务、发送范围和被测数据是否适合共享。实验能力不保证更快或更准确；以实际场景、设备和完整结果为准。

## Android 经典功能

### 录制回放

SoloPi 在手机上录制操作步骤，再用于重复执行与结果检查。支持的节点和动作取决于目标应用及设备。

![Android 录制回放示例](solopi-app/assets/replay.gif)

### 性能工具

性能工具支持指标观察、采集与部分压力场景。指标可用性由设备和系统决定；视频差分响应耗时等功能可能需要额外插件。

![Android 性能工具示例](solopi-app/assets/performance.gif)

原项目曾介绍一机多控，但该功能因稳定性原因**尚未开源**，不能按当前仓库能力使用。更多说明见 [Android README](solopi-app/README.md)。

## 开发与验证

```bash
# Harness 单元测试
python3 -m unittest discover -s solopi-skill/scripts/harness/tests -v

# Android 单元测试与调试构建
./solopi-app/gradlew -p solopi-app \
  :app:testDebugUnitTest :agentmodel:testDebugUnitTest :portal:assembleDebug
```

桌面开发、测试与打包命令见 [Desktop README](solopi-desktop/README.md)。涉及设备、账号、图片或日志时，请使用经授权的测试环境；分享报告前检查截图、日志和个人信息。测试覆盖和支持范围随平台不同而不同，不能以单次通过推断所有设备兼容。

## 文档

- [Android 使用与功能说明](solopi-app/README.md)
- [Desktop 使用说明](solopi-desktop/README.md)
- [三端设备控制](solopi-desktop/docs/THREE_PLATFORM_CONTROL.md)
- [Skill 与 Harness](solopi-skill/SKILL.md)
- [验证计划与结果判定](solopi-skill/references/verification-engine.md)
- [托管执行与设备池](solopi-skill/references/managed-execution.md)
- [故障处理](solopi-skill/references/troubleshooting.md)

## 社区与贡献

欢迎通过 [Issue](https://github.com/alipay/SoloPi/issues)、Pull Request 或 [TesterHome SoloPi 板块](https://testerhome.com/topics/node152)讨论问题与改进。提交前请阅读[贡献指南](CONTRIBUTING.md)。

| 钉钉交流群 | 微信交流群 |
| --- | --- |
| <img src="solopi-app/assets/dingtalk-group.png" width="200" alt="SoloPi 钉钉交流群" /> | <img src="solopi-app/assets/wechat-group.png" width="200" alt="SoloPi 微信交流群" /> |

## 许可证与免责声明

SoloPi 以 [Apache License 2.0](LICENSE) 开源；第三方组件及素材适用各自许可证，详见 [NOTICE](NOTICE.md)。使用前请阅读[免责声明](Disclaimer.md)。
