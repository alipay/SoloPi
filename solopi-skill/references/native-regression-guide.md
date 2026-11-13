# iOS 与 HarmonyOS NEXT：原生回归使用指南

本文中的命令在仓库的 `solopi-skill/` 目录执行。Android 继续使用已有命令和 `--serial`，无需迁移 Android 用例。

## 1. 当前完成了什么

原生平台现在共用验证计划、固定 Result Judge、三态结果、动作回执、原始整屏截图、离线 HTML 报告和托管队列。设备选择、电脑端录制、固定回放、候选决策和 Worker 都有可执行入口。

| 能力 | iOS | HarmonyOS NEXT |
|---|---|---|
| 设备发现与能力检查 | 模拟器及 USB iPhone；WDA 必须匹配准确设备 | HDC 自动查找 SDK；当前只开放本机模拟器 |
| 点击、等待 | 已实现；iPhone 已验证 | 已实现；模拟器已验证 |
| 输入 | 清空后输入；iPhone 已验证 | 空输入框的简单文本；模拟器已验证 |
| 长按 | iPhone 已执行，触摸探针读到一次手势结束 | 暂不开放指定时长的长按 |
| 滚动 | 必须指定容器；iPhone 已验证目标行由不可见变可见 | 必须指定可滚动节点；模拟器已验证新行出现 |
| 返回 | 导航栏内唯一 `Back` / `BackButton`；无已知返回标识时拒绝 | 前台 App 的 Back；模拟器已验证先收键盘、再返回首页 |
| 电脑端录制与固定回放 | iPhone 已验证 | 模拟器已验证 |
| 实时候选接口 | iPhone 用本机确定性服务验证过传输、选候选及独立验收 | 相同接口已实现；尚未完成 NEXT 实时服务端到端样本 |
| 托管执行 | iPhone 已验证领取、执行、结果汇总 | 模拟器五步流程已验证领取、执行、结果汇总 |
| 任意第三方 App、WebView DOM、系统级操作 | 尚不支持通用覆盖；桌面已验证支付宝手机营业厅的特定只读流程 | 不属于本轮交付；NEXT 真机尚未验收 |

这里的“实时候选接口已验证”只证明执行链路正确，并未运行 Laya、GPT 或 Qwen 对比，也没有证明小模型带来性能收益。Android 的性能插件、录屏和被动触摸录制没有同步移植。

桌面入口另在 USB iPhone 的真实支付宝上完成连续录制与固定回放：进入手机营业厅，核验标题及两档面额，必要清理返回首页。冻结用例三轮通过，错误标题对照正确失败，四轮清理和 WDA 会话关闭均成功。具体耗时、桌面配置和边界见 [桌面三端使用指南](../../solopi-desktop/docs/THREE_PLATFORM_CONTROL.md)。这是通过已暴露的原生无障碍节点完成的特定流程，不代表任意第三方 App 或 WebView DOM 自动化已验收。

## 2. 连接设备与检查能力

先按[原生平台环境说明](native-platforms.md)安装运行器。iPhone 必须完成设备信任、开发者模式和开发者证书信任；这些操作不会由脚本绕过。

```bash
scripts/solopi-ai --pretty native-doctor --platform ios
scripts/solopi-ai --pretty native-doctor --platform harmony_next

scripts/solopi-ai --pretty native-capabilities \
  --platform ios --device '<iPhone-UDID>' --device-kind physical --wda-port 18100

scripts/solopi-ai --pretty native-capabilities \
  --platform harmony_next --device 127.0.0.1:5555 --device-kind simulator
```

`native-capabilities` 返回指定设备的 `driverReady`、`availableActions` 和约束。NEXT 输入要求空输入框，文本仅接受字母、数字和 `_-./@`，不接受空格、引号、换行等。复杂文本可能受 SDK 参数解析或输入法自动替换影响，因此在执行前拒绝。已有内容不会静默追加或覆盖。首次输入前由使用者初始化输入法。

已签名构建好的 USB WDA，可用一个前台命令同时管理运行器与 USB 转发：

```bash
scripts/solopi-ai native-wda-start \
  --device '<iPhone-UDID>' --wda-port 18100 \
  --project '/path/to/WebDriverAgent/WebDriverAgent.xcodeproj' \
  --derived-data '/path/to/signed-device-derived-data' \
  --artifacts '/tmp/solopi-wda-logs-new'
```

它不代替首次签名构建。出现 `wda_ready` 后，在另一个终端运行用例；Ctrl-C 只停止本次创建的进程。已经有匹配设备的 WDA 时返回 `already_running`；已有端口属于其他进程时拒绝接管。仅绑定 `127.0.0.1`，不会开放网络控制端口。该辅助入口已验证复用已运行 WDA，以及从已签名构建启动 USB 运行器并执行桌面回归两条路径。证书未受信任时启动被拒绝；需要用户在手机上完成信任后再启动，不会自动授权。

## 3. 编译、校验、执行固定用例

iOS 示例使用 WDA 的原生 IntegrationApp。把示例中的 `targetAppId` 改成自己实际签名安装的 bundle ID，再编译。NEXT 受控 App 的源码放在 `scripts/harness/examples/harmony-hdc/app/`，包含输入框、可滚动列表和详情页；需要使用者自己的本地调试签名，仓库不包含证书、签名配置或安装包。

```bash
scripts/solopi-ai verify-compile \
  --file scripts/harness/examples/harmony-hdc/native-actions.json \
  --output /tmp/solopi-next-plan.json

scripts/solopi-ai verify-validate --plan /tmp/solopi-next-plan.json

scripts/solopi-ai verify-run --plan /tmp/solopi-next-plan.json \
  --native-device 127.0.0.1:5555 --device-kind simulator \
  --artifacts /tmp/solopi-next-run-new
```

执行 iPhone 计划时改用：

```bash
scripts/solopi-ai verify-run --plan /tmp/solopi-ios-plan.json \
  --native-device '<iPhone-UDID>' --device-kind physical --wda-port 18100 \
  --artifacts /tmp/solopi-ios-run-new
```

`platform` 取自冻结计划，统一的 `--native-device` 不会猜平台。旧的 `--ios-device`、`--ios-simulator` 和 `--harmony-emulator` 仍可使用，但不能与统一参数混用。原生计划不会进入 ADB 执行路径。

NEXT 五步示例的作用：先进入详情，输入 `SoloPi` 并独立读回，Back 收起键盘后确认仍在详情，滚动使 `Row 5` 可见，最后 Back 返回首页。它同时覆盖输入值、键盘干扰、滚动结果和页面返回，不只检查动作是否成功。

iOS 的 `integration-scroll-back.json` 先打开 Scrolling 和 ScrollView，再滚动并检查 `25` 行的 `visible` 为 `True`，最后返回并确认 ScrollView 入口。新增的原生 `visible`、`enabled` Oracle 使用字符串预期 `"True"` / `"False"`，不会修改 Android 的 Oracle 字段。

每次使用新证据目录。输入框内容、当前页面和登录状态属于测试前置条件；驱动关闭会话不等于重置 App 数据，不能把上次执行留下的页面当成已满足起点。需要恢复状态时，在计划里写明确的前置条件和清理步骤。

结果目录包含 `plan.json`、`report.json`、`report.html`、`timing.json` 和逐步原始整屏 PNG。HTML 内居中展示完整截图，点击打开原图；JSON 保存原始观察、独立断言、动作回执和清理结果。`passed` 退出 0；`failed`、`not_tested` 退出 2。驱动启动等基础设施错误单独返回错误码。

## 4. 电脑端操作并录制

```bash
scripts/solopi-ai native-record \
  --platform ios --device '<iPhone-UDID>' --device-kind physical --wda-port 18100 \
  --app-id '<your.IntegrationApp.bundleId>' --artifacts /tmp/solopi-recording-new
```

这是保持连接的 JSONL 控制入口，适合 Skill 或电脑端控制界面驱动，不是在 iPhone 上被动捕获自由触控。图形入口见 [桌面三端使用指南](../../solopi-desktop/docs/THREE_PLATFORM_CONTROL.md)；本节描述 CLI。标准输出每行一个 JSON 事件，先返回 `ready`，随后依次发送：

1. `{"type":"observe"}`：返回当前页面、`observationId` 和截图。
2. `{"type":"act","observationId":"上一步的真实ID","action":{"type":"click","selector":{"accessibilityId":"Alerts"}}}`：绑定该观察执行一次，并录入步骤。
3. `{"type":"assert","oracle":{"type":"ui","selector":{"accessibilityId":"Create Camera Roll Alert"},"field":"text","operator":"equals","expected":"Create Camera Roll Alert"}}`：显式记录固定验收条件。
4. `{"type":"end"}`：校验并生成 `requirement.json`。

每次动作前重新 `observe`，不能复用示例里的占位 ID。编辑导出的步骤 JSON 后重新 `verify-compile`、`verify-validate`，再使用 `verify-run` 回放。录制不会把当前实际值自动变成预期；断言由使用者明确给出，失败断言也不会改成通过。

动作意图先写盘，再发送物理动作。连接丢失、执行异常或输入流中断会留下 `interrupted` 录制及最近回执，不能直接续跑；应检查现场并重新开始独立尝试。没有显式断言的录制不能导出为完成用例。

## 5. 接入实时候选决策

动态段保留既有 `explore`、`goal`、`allowedActions` 和预算。用以下选项接本机服务：

```bash
scripts/solopi-ai verify-run --plan /tmp/solopi-ios-dynamic-plan.json \
  --native-device '<iPhone-UDID>' --device-kind physical --wda-port 18100 \
  --native-decision-endpoint http://127.0.0.1:18765/decide \
  --artifacts /tmp/solopi-native-dynamic-new
```

服务接收 HTTP POST，包含当前 `observation`、有限 `candidates`、子目标及最近动作历史。每个候选绑定当前观察，输入文本只能来自计划 `testData`；服务返回 `{"type":"act","candidateId":"当前候选ID"}`、`{"type":"done"}` 或 `{"type":"blocked"}`。不接受模型自造的节点、坐标、Shell 或自由输入文本。

候选会排除重复标识和不可操作节点；执行器再次核对页面、目标和可命中性。最多提供 200 个候选，超出则停止；受步骤、总时长、空闲、重复动作和无进展预算约束。服务异常不自动重试动作，不自动降级坐标点击。`done` 后重新观察，只有固定 Result Judge 可以判通过。

这与 Android 的 FastPath/GoalPath policy 不是同一输入契约，不能直接把 `--decision-provider fastpath` 传给原生任务。需要给 Laya 等模型写一个候选协议适配服务；本轮没有把未经评测的模型路由默认开启。

## 6. 托管执行与重启配置

```bash
scripts/solopi-ai managed-device-register --database /tmp/native-ci.sqlite \
  --device-id team-iphone --device-serial '<iPhone-UDID>' \
  --platform ios --device-kind physical --wda-port 18100 \
  --api-level 27 --capability verification

scripts/solopi-ai managed-submit --database /tmp/native-ci.sqlite \
  --plan /tmp/solopi-ios-plan.json --matrix /tmp/native-matrix.json \
  --idempotency-key native-build-001

scripts/solopi-ai managed-worker-once --database /tmp/native-ci.sqlite \
  --worker-id native-worker --artifacts-root /tmp/native-ci-runs
```

`native-matrix.json` 的内容为 `[{"id":"iphone","selector":{"platform":"ios","capabilities":["verification"]}}]`。NEXT 注册时使用 `--platform harmony_next --device-kind simulator`、准确 HDC ID 和 API 级别。iOS 的 `api-level` 是已有设备池字段，此处填写系统主版本作筛选，不代表它与 Android API 具有相同含义。

平台和能力参与匹配，矩阵平台必须与计划一致。设备类型和 WDA 端口随注册信息持久化，Worker 重启后从设备池读取。动态任务需要在每次启动 Worker 时显式带 `--native-decision-endpoint`；该端点是 Worker 本地配置，不会由远端任务任意指定。

每次原生观察和物理动作前检查准确租约与代次，取消或失去租约后停止。继承现有迟到结果隔离与独立尝试目录；原生任务提交时强制零自动重试，即使回包丢失也不会自动重新执行整条流程。回收过期任务不拼接旧证据。平台本身不提供跨进程物理动作的原子 fencing，因此这些检查不能宣传为“设备级 exactly-once”；真实断线及多进程接管仍需扩大故障验收。

## 7. 本轮设备实验

以下都是单次样本，时间取 `timing.json.hostElapsedMs`，包含设备观察、执行、截图和报告导出，不包含首次安装、签名构建与用户授权。不能据此计算稳定通过率、P50/P95 或模型加速比。

| 环境与场景 | 结果 | 单次耗时 | 原始整屏截图 |
|---|---|---:|---:|
| iPhone：列表滚动使目标行可见，再返回 | passed | 38.05 秒 | 4 张 |
| iPhone：录制的进入页面与长按流程回放 | passed | 11.92 秒 | 2 张 |
| iPhone：本机候选服务选择 Alerts，再由固定断言验收 | passed | 8.87 秒 | 2 张 |
| iPhone：Worker 领取并执行录制用例 | passed | 11.90 秒 | 2 张 |
| NEXT 模拟器：输入、读回、收键盘、滚动、返回 | passed | 25.51 秒 | 5 张 |
| NEXT 模拟器：录制的普通文本输入回放 | passed | 10.73 秒 | 2 张 |
| NEXT 模拟器：Worker 领取并执行五步原生流程 | passed | 24.59 秒 | 5 张 |
| NEXT 模拟器：物理点击已送达后注入回包丢失 | not_tested；保留 outcome_unknown | 不作正常耗时样本 | 保存现场截图与回执 |

最后一个实验对计数器先 Reset 再 Increment，在真实 Increment 已执行后由测试注入连接异常。重提相同步骤只取到缓存的 `outcome_unknown`，没有第二次 Increment；独立重新观察计数仍为 `1`。这是“丢失回包注入”，不是拔线实验。目标替换、遮挡、过期观察、错误业务预期和失去租约另有自动测试；完整拔线、运行器崩溃和多进程接管仍未全部做设备故障矩阵验收。

## 8. 尚不能宣称对齐的部分

当前已交付原生测试 App 的基础回归链路，并新增 Android / iPhone 真机及 NEXT 模拟器桌面节点录制、固定回放和错误预期验收。NEXT 桌面验证使用受控原生 App，三轮冻结回放通过、一轮错误标题正确失败；详情见桌面使用指南。还需要完成 NEXT 真机验收、更多 iOS 返回标识适配、复杂输入与替换、更完整的图形编辑体验、真实断连/重连和 Worker 接管故障矩阵、更大规模重复运行，以及由独立使用者照公开文档完成首次安装与回放。不要把单台 iPhone 和 NEXT 模拟器的样本等同于 Android 全部能力已对齐。
