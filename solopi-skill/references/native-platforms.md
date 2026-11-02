# iOS 与 HarmonyOS NEXT 进度和使用边界

当前代码完成了跨平台验证计划契约，并接入了 **iOS Simulator / USB iPhone + WebDriverAgent** 和 **HarmonyOS NEXT 模拟器 + HDC `uitest`** 的基础固定回归闭环。iPhone 已验证点击、输入、长按、滚动、返回、录制回放、候选接口和基础 Worker；NEXT 模拟器已验证输入、滚动、键盘返回、录制回放和 Worker。NEXT 真机尚未验收。完整用法、实测耗时与尚未交付的部分见[原生回归使用指南](native-regression-guide.md)。

| 能力 | Android | iOS | HarmonyOS NEXT |
|---|---|---|---|
| `verify-compile` / `verify-validate` | 已实现 | 已实现 | 已实现平台与选择器契约 |
| 设备发现诊断 | `doctor` | `native-doctor` 检查模拟器；显式指定 iPhone 和端口时检查 USB WDA | `native-doctor` 自动发现 SDK 中的 HDC 和模拟器 |
| 固定验收和三态报告核心 | 已实现并在真机使用 | iOS 模拟器与一台 iPhone 实测通过/错误预期失败 | NEXT 模拟器实测通过/错误预期失败；真机未验证 |
| 受控动作、页面观察、截图回执 | 已实现 | iPhone 实测点击、输入、长按、容器滚动、导航返回及整屏 PNG | 模拟器实测点击、简单文本输入、滚动、返回及整屏 PNG；复杂输入暂不支持 |
| 录制、动态决策、托管 Worker | 已实现 | 静态清单、电脑端 JSONL 录制、回放、候选服务及 Worker 已跑通 | 静态清单、电脑端 JSONL 录制、回放及 Worker 已跑通；实时服务尚未设备验收 |

运行诊断：

```bash
scripts/solopi-ai native-doctor --platform ios
scripts/solopi-ai native-doctor --platform harmony_next
```

`devices` 列出发现的非本机模拟器连接，`simulators` 列出已启动的模拟器。未指定 iPhone 时，iOS 的 `driverReady` 只探测模拟器；指定 `--ios-device` 和 `--wda-port` 时，以该手机的 USB WDA 检查结果为准，详情见 `physicalDevice`。iOS 真机发现依赖 `idevice_id`，模拟器发现依赖 `xcrun simctl`；NEXT 从 PATH 或 `~/Library/Huawei/command-line-tools-*/sdk/default/openharmony/toolchains/hdc` 查找 HDC。诊断不会安装、启动或签名测试运行器。

## iOS 模拟器实测

本机 Xcode 26.3、iPhone 16 Pro / iOS 18.3 模拟器使用 Appium [WebDriverAgent](https://github.com/appium/WebDriverAgent) `v16.15.3` 自带的原生 `IntegrationApp`。WDA 构建时，本机 Xcode 缺少两个可选测试依赖，通过构建参数排除它们，未修改上游源码。先启动模拟器，再构建并运行：

```bash
xcrun simctl boot <simulator-udid>
mkdir -p ~/.solopi-ai/tools
git clone --depth 1 --branch v16.15.3 https://github.com/appium/WebDriverAgent.git ~/.solopi-ai/tools/WebDriverAgent
cd ~/.solopi-ai/tools/WebDriverAgent
USE_IP=127.0.0.1 xcodebuild test -project WebDriverAgent.xcodeproj -scheme WebDriverAgentRunner \
  -destination 'platform=iOS Simulator,id=<simulator-udid>,arch=arm64' \
  -derivedDataPath /tmp/solopi-wda-derived CODE_SIGNING_ALLOWED=NO \
  'WDA_XCTEST_EXCLUDED_2600=XCTest.framework XCTestCore.framework XCUIAutomation.framework XCTAutomationSupport.framework Testing.framework ResultDataPublisher.framework XCTestSupport.framework libXCTestSwiftSupport.dylib lib_TestingInterop.dylib _Testing_Foundation.framework' -quiet
```

启动 Runner 前设置 `USE_IP=127.0.0.1`；WDA 默认可能监听全部网卡，SoloPi 会拒绝非回环监听。Runner 启动后，另一个终端检查 `native-doctor --platform ios` 的 `driverReady`。首次构建后可用相同参数将 `test` 改为 `test-without-building` 快速重新启动；测试命令会持续运行，结束时按 Ctrl-C。构建测试 App：

```bash
xcodebuild build -project WebDriverAgent.xcodeproj -scheme IntegrationApp \
  -destination 'platform=iOS Simulator,id=<simulator-udid>,arch=arm64' \
  -derivedDataPath /tmp/solopi-integration-derived CODE_SIGNING_ALLOWED=NO -quiet
xcrun simctl install <simulator-udid> /tmp/solopi-integration-derived/Build/Products/Debug-iphonesimulator/IntegrationApp.app
```

回到 SoloPi 仓库，执行示例：

```bash
solopi-skill/scripts/solopi-ai verify-compile \
  --file solopi-skill/scripts/harness/examples/ios-wda/integration-alerts.json \
  --output /tmp/solopi-ios-plan.json
solopi-skill/scripts/solopi-ai verify-validate --plan /tmp/solopi-ios-plan.json
solopi-skill/scripts/solopi-ai verify-run --plan /tmp/solopi-ios-plan.json \
  --artifacts /tmp/solopi-ios-run --ios-simulator <simulator-udid>
```

实测正向用例点击 `Alerts`，checkpoint 观察到 `Create Camera Roll Alert`，报告 `passed`，退出码 0，约 4.5 至 7.3 秒。把同一 checkpoint 的预期改成 `Not present` 后，动作仍成功，独立验收返回 `failed`，退出码 2，约 4.8 秒。多步 `integration-input.json` 用例连续点击并输入 `SoloPi`，独立读回输入框值，报告 `passed`，约 10.9 秒，保存两张整屏截图。三次运行均保存整屏 PNG、观察、动作回执、计划、WDA 会话关闭状态和计时报告。当前驱动允许 `click`、`input`、`longClick`、有选择器的 `scroll`、页面内 `back` 和 `wait`；不提供任意坐标、Shell 或系统级 `home`。滚动和返回已新增 iPhone 流程验收，详细范围见使用指南。

## iPhone 真机实测与使用

已在 USB 连接的 iPhone 15 Plus 上验证。手机配对、开发者模式、开发者证书信任和开发者磁盘服务均就绪；真机版 WDA 与 `IntegrationApp` 使用同一开发团队签名。本机 Xcode 26.3、手机 iOS 27.2 Beta 的组合实际启动成功，但不能推断其他系统和 Xcode 组合均兼容。

先签名、安装并通过 Xcode 测试方式运行 WDA（仅打开 Runner 图标不能替代 XCUITest 会话）。可沿用上文 WDA 构建命令，将 destination 改为 `platform=iOS,id=<iphone-udid>`，去掉 `CODE_SIGNING_ALLOWED=NO`，传入自己的 `DEVELOPMENT_TEAM`、唯一 `PRODUCT_BUNDLE_IDENTIFIER` 和 `CODE_SIGN_STYLE=Automatic -allowProvisioningUpdates`；真机产物使用独立 derivedDataPath。测试 App 也必须独立签名安装。不要将开发证书、私钥或 provisioning profile 放入仓库。

手机上完成「设置 → 通用 → VPN 与设备管理 → 开发者 App → 信任」。首次启动的网络授权等系统弹窗应在正式回归前按测试前置条件处理；本次离线测试选择了“不允许”网络访问。驱动遇到弹窗会返回 `unexpected_alert`，不会自动点击授权。

WDA 在设备端端口 8100 就绪后，在独立终端保持以下 USB 转发命令运行。当前实现校验完整命令参数，请保留这些参数的写法和顺序：

```bash
iproxy --udid <iphone-udid> --local --source 127.0.0.1 18100:8100
```

Harness 校验监听仅在 `127.0.0.1`、进程归属当前用户、转发明确绑定所选 UDID 且仅走 USB，然后才连接本机 WDA。将 `examples/ios-wda/integration-alerts.json` 或 `integration-input.json` 复制到自己的用例目录，并把 `targetAppId` 改为实际签名安装的测试 App bundle ID，随后运行：

```bash
solopi-skill/scripts/solopi-ai native-doctor --platform ios \
  --ios-device <iphone-udid> --wda-port 18100
solopi-skill/scripts/solopi-ai verify-compile \
  --file <requirement.json> --output /tmp/solopi-iphone-plan.json
solopi-skill/scripts/solopi-ai verify-validate --plan /tmp/solopi-iphone-plan.json
solopi-skill/scripts/solopi-ai verify-run --plan /tmp/solopi-iphone-plan.json \
  --artifacts /tmp/solopi-iphone-run --ios-device <iphone-udid> --wda-port 18100
```

`--artifacts` 必须是尚不存在的目录。`--ios-device` 与 `--ios-simulator` 互斥，报告以 `deviceKind: physical` 标识真机。

| 真机用例 | 固定验收 | 实测结果 | 全流程耗时 |
|---|---|---|---|
| 点击 Alerts 打开原生页面 | 存在 Create Camera Roll Alert 控件且文案一致 | passed | 4.61 秒 |
| 打开 Alerts，输入冻结数据 SoloPi | 输入框独立读回 SoloPi | passed | 10.37 秒 |
| 相同页面跳转，故意将预期改为 Not present | 实际仍为 Create Camera Roll Alert | failed，oracle_mismatch，退出码 2 | 5.74 秒 |
| 打开页面后点击 Create App Alert，产生对话框 | 弹窗存在时停止后续观察和验收 | not_tested，unexpected_alert，退出码 2 | 8.86 秒 |

以上是单次样本的 `verification.total`，不含首次签名构建、安装和证书信任时间，也不是 P50/P95 性能结论。每步保存 1290 × 2796 原始整屏 PNG、页面观察、动作回执、冻结计划和独立验收结果；弹窗中止时仍保存最近动作回执和现场截图，报告包含 WDA 会话关闭状态。调试中曾遇到旧测试包不可用提示和首次网络授权弹窗，相应运行保留了失败或未测试结果，不计入上表通过样本。

当前真机验证范围是原生测试 App；长按、滚动、返回、电脑端 JSONL 录制回放和基础 Worker 已新增验收。真实拔线与 Worker 接管故障矩阵、WebView 和第三方 App 尚未完成验收。

## HarmonyOS NEXT 模拟器实测

本机模拟器 HDC ID 为 `127.0.0.1:5555`，原生测试 App `com.alipay.solopi.harnessdemo` 已安装。系统内置 `uitest` 可以采集页面树和整屏截图，并对当前页面执行点击。驱动从完整窗口树确认测试 App 在前台，使用节点 `id` 定位；`NativeSession` 在动作前重新观察目标，驱动发送点击前再次核对窗口、节点文案、边界和外部窗口遮挡。通信结果不确定时不重发点击。计划不接收原始坐标。

启动模拟器并安装测试 App 后运行：

```bash
solopi-skill/scripts/solopi-ai native-doctor --platform harmony_next
solopi-skill/scripts/solopi-ai verify-compile \
  --file solopi-skill/scripts/harness/examples/harmony-hdc/counter.json \
  --output /tmp/solopi-harmony-plan.json
solopi-skill/scripts/solopi-ai verify-validate --plan /tmp/solopi-harmony-plan.json
solopi-skill/scripts/solopi-ai verify-run --plan /tmp/solopi-harmony-plan.json \
  --artifacts /tmp/solopi-harmony-run --harmony-emulator 127.0.0.1:5555
```

实测用例先点 `Reset`，再点 `Increment`，固定 checkpoint 独立读到计数 `1`，报告 `passed`、退出码 0，总耗时 6.97 秒。错误预期示例 `counter-wrong-result.json` 执行相同动作但要求计数 `2`，报告 `failed`、退出码 2，`actual` 为 `1`，总耗时约 7.2 秒。两次均保存每步整屏 1316 × 2832 PNG、页面观察和动作回执。另已完成简单文本输入、滚动、键盘返回、录制回放及 Worker 五步流程验证，详细结果见使用指南；真实拔线恢复和 NEXT 真机仍未验收。

原生需求沿用 `solopi.ai.requirement/v1`，在顶层指定 `platform: ios` 或 `platform: harmony_next`，用 `targetAppId` 指定测试 App。选择器契约支持 `accessibilityId`、`text`、`description`、`className`、`appId`、`id`，不接受 Android `resourceId`；当前 WDA 动作定位要求目标具备 `accessibilityId`，NEXT 点击要求目标具备稳定 `id`，否则拒绝执行。固定 checkpoint 仍由独立 Result Judge 判定。iOS 模拟器必须显式传 `--ios-simulator`，iPhone 使用 `--ios-device`，NEXT 模拟器使用 `--harmony-emulator`；未绑定驱动时以 `native_driver_unavailable` 拒绝，且不会连接 ADB 或创建证据目录。

接入真实设备的门槛：iOS 需要可调试 iPhone、签名的 XCUITest/WebDriverAgent 运行器、确定的设备身份和本机控制端口；NEXT 需要真机、HDC、与目标应用匹配的测试 HAP 和经真机验证的 UI 测试接口。NEXT 模拟器已补齐受限输入、滑动、返回及键盘流程；两端已有电脑端 JSONL 录制和基础 Worker 能力匹配。NEXT 真机、真实断线与接管、图形录制界面和独立使用者验收仍是完整交付前的门槛。
