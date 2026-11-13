# FastPath 原生 Android 演示

单 Activity、Java 原生控件、无第三方库、无网络；订单和金额均为虚构数据。测试通知在 Android 13 及以上需要用户授予通知发送权限。
此应用专门提供可复现的页面变化和失败样本，不是实际商城。

「12 受保护窗口」会打开使用 `FLAG_SECURE` 的测试弹窗，用于验证虚拟屏遇到黑屏时停止。弹窗只属于演示应用，不涉及真实账号；设备和厂商对受保护窗口的呈现可能不同。

「目标自动替换」会在进入页面 15 秒后移除原订单入口并放入新的入口，用于检查旧观察不得操作替换后的目标。返回场景选择会取消该定时变化。

「页面持续变化」会在进入后持续更新页面状态约 16 秒，用于复现动作提交后页面无法及时稳定的情况；返回场景选择会取消变化。

「模拟应用跳至主屏」仅用于受控测试：演示应用会在主屏启动自身的新任务并结束副屏 Activity，用于验证副屏任务停止；测试后需关闭该演示应用。

## 本地构建与启动

需要 JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。构建不访问网络。

```bash
python3 build.py --sdk "$HOME/Library/Android/sdk" --java-home "$(/usr/libexec/java_home -v 17)"
# 使用构建输出的 APK 路径（默认在系统临时目录）。
adb install -r /path/from/build/output/fastpath-demo.apk
adb shell am start -n com.solopi.fastpath.demo/.MainActivity
```

可以使用 `--output` 指定输出目录；调试密钥保留在该目录以便重复覆盖安装。
APK、密钥、编译中间文件不能提交到 Git。完整 SoloPi 仍使用项目现有 Gradle 构建。

### 受控聊天夹具

使用 `python3 build.py --reply-fixture` 构建独立包 `com.solopi.fastpath.replyfixture`，与原演示应用并存。首页「受控聊天」只在此包中出现，所有消息和联系人都是本地测试数据；发送按钮只追加本地消息，不调用网络。聊天页面可模拟新问题、相同内容的另一条消息、非问题、图片、撤回、群聊及同名联系人，也可单独发送固定测试通知。通知只是唤醒信号，不携带待回复数据。

为便于受控测试，页面的无障碍节点提供以下夹具专用约定。实际安装包为 `com.solopi.fastpath.replyfixture`，资源 ID 前缀仍是 `com.solopi.fastpath.demo:id/`。这些测试标记并不代表任何真实应用提供相同字段。

| 资源 ID | contentDescription / 用途 |
| --- | --- |
| `scenario_chat` | 进入新的受控聊天，初始含历史消息 `old-1` |
| `chat_identity` | `fixture:conversation:<id>:<single|group>:<unique|ambiguous>` |
| 消息总数 | `fixture:message-count:<count>:<instance>`，由受控聊天模型生成；适配器要求总数与完整连续序列一致，每次重新进入聊天时生成新实例标识 |
| `chat_message` | `fixture:message:<id>:<incoming|outgoing|system>:<text|image|other>:<active|retracted>`，节点文字为消息正文 |
| `chat_input`、`chat_send` | 本地回复输入框和发送按钮 |
| `chat_arrival`、`chat_duplicate` | 增加新问题或另一条相同正文的问题，各自分配不同 ID |
| `chat_nonquestion`、`chat_picture`、`chat_retract` | 增加非问题、图片消息或撤回最新收到的消息 |
| `chat_group`、`chat_ambiguous` | 将当前会话改为群聊或同名联系人场景；重进聊天重置 |
| `chat_wake` | 单独发送固定测试通知 |
| `chat_image_content` | 打开图片后的画面区域，description 为 `fixture:image:<id>` |

模型契约的纯 Java 测试位于 `tests/com/solopi/fastpath/demo/FixtureChatTest.java`，可用 JDK 编译并运行，不需网络或设备。将聊天页面置于副屏、读取通知、执行安全输入和发送后验收需要单独的集成测试，不能以这个夹具的本地单测代替。

### 与原 SoloPi 并存的验证副本

如果设备现有 SoloPi 的签名与本地调试签名不同，保留原安装和数据，在 `solopi-app`
使用现有 JDK 11 构建：

```bash
./gradlew :portal:assembleDebug -PfastpathDebug --no-daemon
```

可选属性仅影响 debug 构建，产生包名 `com.alipay.hulu.fastpath`、显示名称
`SoloPi FastPath` 的验证副本，FileProvider authority 随包名变化。默认公共文件根目录为
`/sdcard/solopi-fastpath`，系统不允许公共目录写入时仍使用副本自己的 external files 目录。
首轮初始化不会使用原应用的数据库、偏好或默认 `/sdcard/solopi` 文件目录。
默认构建保持原包名、名称与文件目录。

该副本仅用于 FastPath 原型验证，不代表录制、回放、输入法或自动授权等所有功能已支持改包。
原有输入法切换、辅助功能自动重启和部分录制/回放临时文件逻辑仍有原包或目录硬编码，
本轮不使用这些路径。需要用户为明确标为 `SoloPi FastPath` 的副本开启辅助功能。
副本默认控制端口为 `23343`，原应用仍为 `23342`；控制器应同时配置
`--package com.alipay.hulu.fastpath --device-port 23343`，避免请求落到原应用。
Java Activity 类名保持原包前缀，
如 `com.alipay.hulu.fastpath/com.alipay.hulu.activity.SplashActivity`。

### 原生库的 16 KB 对齐

原项目的 `nativeModule` 在旧 NDK 21 下默认生成 4 KB 对齐的 ARM64 ELF，
部分新设备首启会显示兼容警告。现在仅给此目标的 64 位构建增加
`-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384`，符合
[Android 官方旧 NDK 指引](https://developer.android.com/guide/practices/page-sizes)，
没有升级 AGP 或 NDK。普通 SoloPi 构建也使用这些参数。

构建后应从 APK 抽取 `lib/arm64-v8a/libnativeModule.so`，使用 NDK 的
`llvm-readelf -Wl` 检查每条 `LOAD` 的对齐至少为 `0x4000`，且
`GNU_RELRO` 的 `VirtAddr + MemSiz` 为 `0x4000` 的整数倍。
再用 Build Tools 35+ 执行 `zipalign -v -c -P 16 4 <apk>`。
本轮通过这两项产物检查；完整 16 KB 运行兼容仍需针对使用的 native 功能进行真机测试。

## 界面协议

所有资源 ID 的前缀为 `com.solopi.fastpath.demo:id/`。
首屏的按钮 `scenario_baseline`、`scenario_renamed`、`scenario_popup`、
`scenario_loading`、`scenario_broken`、`scenario_unknown`、`scenario_disabled`
分别打开对应场景。任意页面的 `reset_button` 返回场景选择。

| ID | 行为或值 |
| --- | --- |
| `page_state` | `SCENARIOS` / `ORDERS` / `DETAIL` / `LOADING` / `UNKNOWN` / `WRONG` |
| `action_primary` | 正确目标：进入订单详情；baseline 文案“查看订单详情”，renamed 文案“看看这笔订单”且移动到第二位 |
| `action_secondary` | “查看物流”，进入 `WRONG` 页面 |
| `action_tertiary` | “联系商家”，进入 `WRONG` 页面 |
| `dismiss_popup` | popup 场景唯一可执行的服务动作，“暂时不用”，关闭内嵌非关键提示 |
| `order_status` | 详情页正常为“已支付”；broken 为“已取消” |

popup 场景在关闭提示前禁用全部订单服务按钮；disabled 场景只禁用
`action_primary`（`isEnabled=false`）；loading 在 8 秒后进入订单页，重置会取消计时器。
unknown 页面没有订单动作。

统一任务：打开订单 `FP-20260923` 的详情，并独立核对 `order_status` 为“已支付”。
改名、重排、关闭已声明提示可以是允许变化；broken 必须被结果验收判为失败。
未知页面和无可用目标应停止执行，不能通过选择其他服务来凑完成。

演示保留稳定资源 ID 便于复现实验。决策器若把 `action_primary` 直接当作正确答案，
测到的是规则匹配能力；对比 Laya 时，应让语义选择只消费候选文案，并在候选排序上做变体。
