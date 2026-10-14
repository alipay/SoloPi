# FastPath 原生 Android 演示

单 Activity、Java 原生控件、无第三方库、无权限、无网络；订单和金额均为虚构数据。
此应用专门提供可复现的页面变化和失败样本，不是实际商城。

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
