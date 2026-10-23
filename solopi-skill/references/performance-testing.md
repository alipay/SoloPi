# SoloPi 性能与压力测试

本文说明如何安全管理性能实时监控与采集、安卓应用启动耗时、录屏视频差分视觉响应耗时和 CPU/内存压力会话。实时监控返回当前指标值，性能采集保存连续 CSV，启动耗时读取安卓 Activity Manager 的单次启动结果，视频分析计算受控录屏中的界面变化，压力会话主动消耗设备资源；各自口径、标识和成功条件不同。

## 性能采集边界

- CLI 负责指标发现、实时值、实时监控会话、连续采集、停止保存、原始数据拉取以及历史的列表/详情/精确删除；不内置阈值或图表，也不输出“性能达标”。
- 指标由当前设备和构建动态提供。常见指标包括 `Battery`、`CPU`、`FPS`、`Memory`、`Network`、`Response`、`Status`、`Temperature`，使用前仍必须运行 `perf-list`，只选择本次设备实际返回的键。
- `state=stopped` 只证明采集停止且保存完成。是否达标仍需明确指标、统计口径、稳定区间、阈值和基线。
- CLI 不提供上传参数。不得自动外发包名、进程、网络、设备状态或业务时序数据。

### 性能命令

| 命令 | 用途 | 成功条件 |
|---|---|---|
| `perf-list` | 查询指标键、名称、权限和提示 | `success=true` |
| `perf-current` | 读取当前已运行监视器的即时值 | 查询成功；空集合表示当前没有运行项 |
| `perf-display-start` | 启动实时监控并等待指标实例就绪 | `state=running`、目标包和指标集合匹配且退出码为 `0` |
| `perf-display-status` | 按 `sessionId` 查询实时监控与当前值 | 会话匹配，`sampledAt` 和租约绑定的 `values` 有效 |
| `perf-display-stop` | 停止准确实时监控并清理显示项 | `state=stopped` 且退出码为 `0` |
| `perf-start` | 启动指标并等待实际采集 | `state=recording` 且退出码为 `0` |
| `perf-status` | 按 `sessionId` 查询会话 | 会话匹配且响应有效 |
| `perf-stop` | 停止准确会话、等待保存并可拉取目录 | `state=stopped` 且退出码为 `0` |
| `perf-analyze` | 分析本地性能 CSV 的描述性统计 | CSV 全部安全解析；不表示指标达标 |

连续采集状态流转：

```text
idle -> starting -> recording -> stopping -> stopped
       \-----------------------> failed
```

实时监控状态流转：

```text
idle -> starting -> running -> stopping -> stopped
       \---------------------> failed
```

两类会话共享 `DisplayProvider` 和同一个运行门闩，不能并发，也不能接管 App 手工性能面板。CLI 启动前会分别检查实时监控与连续采集状态；设备端仍以原子租约作为最终并发判定。

### 实时监控

先选择准确目标包和设备实际提供的指标：

```bash
scripts/solopi-ai --pretty doctor
scripts/solopi-ai --pretty perf-list
scripts/solopi-ai --pretty perf-display-start \
  --target-package "com.example.pay" \
  --items "Battery,CPU,Memory,FPS"
scripts/solopi-ai --pretty perf-display-status --session-id '<session-id>'
scripts/solopi-ai --pretty perf-display-stop --session-id '<session-id>'
```

`--target-package <包名>` 与 `--global` 必须二选一。CPU、内存等与应用进程相关的指标通常使用具体包名；电池、温度等设备级指标可使用 `--global`。最终仍以 `perf-list` 返回的指标契约和真机结果为准，不能仅凭名称猜测作用域。连续采集的 `perf-start` 采用相同目标选择规则。

`perf-display-status` 返回的 `values` 只读取该 `sessionId` 租约实际拥有的显示实例；名称相同但实例已更换时不会误读。为避免设备采样阻塞控制服务，本次响应返回最近一次成功值并触发后台刷新；首次查询可能为空或含 `null`，等待一个采样周期后用同一 `sessionId` 再查。`sampledAt` 是这次响应组装快照的时间，不表示每个缓存值都在该毫秒同步采集。不同指标的内容格式由插件决定，可能是带单位的字符串，调用方不得擅自改写成统一数值。`runningItems` 可用于诊断共享服务占用，但不是当前会话的所有权证明；所有权以 `ownedDisplayNames` 和准确 `sessionId` 为准。

启动、业务失败、超时或中断后都要停止原会话。设备清理不完整时保持 `stopping` 并明确返回 `stopRetryable=true`；`perf-display-stop` 只据此在共享 `--stop-timeout` 预算内最多重试三次。未确认 `stopped` 或 `failed` 前，不启动性能录制、另一实时监控或插件变更。

### 连续采集

先从用例或 `apps` 获取准确目标包名，再发现指标并启动：

```bash
scripts/solopi-ai --pretty doctor
scripts/solopi-ai --pretty perf-list
scripts/solopi-ai --pretty perf-start \
  --target-package "com.example.pay" \
  --items "CPU,Memory,FPS" \
  --ack-timeout 30
scripts/solopi-ai --pretty perf-status --session-id '<session-id>'
scripts/solopi-ai --pretty perf-stop \
  --session-id '<session-id>' \
  --stop-timeout 60 \
  --output artifacts/performance-20260806-001
```

保存 `perf-start` 返回的 `sessionId`。`--output` 必须是尚不存在的新目录；省略时设备端仍保存数据。

### 与回放组合

1. 运行 `doctor`、`perf-list`。
2. 运行 `perf-start`，保存 `sessionId` 并确认 `recording`。
3. 运行用例，单独保存每个 `runId` 和回放证据。
4. 在清理阶段无条件查询并停止原性能会话。
5. 分别报告回放结果和采集结果，不得合并成一个“通过”。

回放为 `failed`、`cancelled`，或 CLI 返回 `124`、`130` 时，性能清理责任仍然存在。未确认原会话终态前不得开始新采集。

设备端清理失败时，状态会保持 `stopping` 并返回 `stopRetryable=true`。`perf-stop` 只在该字段明确为真时使用同一 `sessionId` 自动重试，单次调用最多重试三次；`--stop-timeout` 是首次停止请求、自动重试和终态轮询共享的总预算，不包含控制服务建连、首次状态预检和 `--output` 产物拉取。达到重试或时间上限后返回失败并保留会话信息，调用方可排查后再次执行同一停止命令。不得用错误文案猜测是否可重试，也不得停止其他会话。

正常情况下，`perf-stop` 会先查询状态并核对当前会话与 `--session-id` 完全一致。仅当这次预检返回类型明确的“SoloPi 控制服务不可达”传输错误时，CLI 才会把调用方保存的准确 `sessionId` 原样发送到受保护的停止入口，并在同一个 `--stop-timeout` 预算内继续查询该会话。恢复轮询只容忍暂时的同类不可达；无效 JSON、协议字段错误、会话标识不匹配及设备明确返回的业务错误都会立即失败。只有最终读到同一会话的终态后才会返回 `recoveredWithoutPreflight=true`，停止请求已发出或轮询超时都不能当作清理成功。

### 性能数据

- 每个记录序列生成一个 CSV；名称可能本地化。
- 文件编码遵循设备设置，常见默认值为 `GBK`，但不得假定固定编码。
- 设备端按 `sessionId` 使用独占目录，全部文件写完后才发布最终目录。
- `perf-stop --output` 只拉取 `recordsRoot` 下准确会话目录，拒绝根外路径、控制字符、`..` 和已有本地目录；确认至少一个 CSV 后才返回本地产物。

使用 `perf-analyze --input <证据目录>` 分析已经拉取的目录。命令支持 UTF-8、带签名 UTF-8 和 GBK，递归读取有界数量与大小的普通 CSV 文件；逐列输出 `sampleCount`、`min`、`max`、`mean`、`median`、`p90`，P90 使用最近秩口径。空值计入 `missingCount`，含非数值或非有限值的整列会以 `skipped` 和原因明确跳过。结果固定标记为仅描述性分析，不接受隐式阈值，也不输出达标结论。

## 视频差分视觉响应耗时

先用 `screen-record-start/status/stop` 完成独立录屏并保存停止结果中的设备端 `outputPath`。用户必须确认 MediaProjection；CLI 不会替代。然后执行：

```bash
scripts/solopi-ai --pretty video-analysis-start \
  --video-path '<device-outputPath>' \
  --action-offset-ms 850 \
  --difference-threshold 0.2 \
  --analysis-timeout 120
```

`--action-offset-ms` 是动作发生相对录屏起点的毫秒偏移，范围 `0..3600000`；必须来自实际录制时序，不能猜测。`--difference-threshold` 必须大于 `0` 且不超过 `1`，其选择会改变检测结果，跨轮对比时保持一致并记录。CLI 只接受设备 `ScreenCaptures` 的直属 MP4，设备端再次做规范路径、非空文件和插件检查。

保存启动返回的 `requestId`。默认等待 `completed` 或 `failed`；使用 `--no-wait` 时，后续必须执行 `video-analysis-status --request-id <id>`。只有 `completed`、非负 `visualResponseTimeMs` 与退出码 `0` 同时满足才是有效结果。设备端分析任务最长运行 5 分钟，超时后写入 `failed` 回执并释放分析占用；迟到的插件结果不会覆盖该终态。`plugin_missing`、`analysis_busy`、`unsafe_video_path`、`analysis_failed` 或超时均失败。该结果测量从动作时刻到视频差分检测出的稳定变化，不等同于 Activity Manager 启动耗时，也不自动上传。

## 安卓应用启动耗时

`startup-time` 使用固定的 `adb shell am start -W` 测量 Activity Manager 启动耗时。它只要求 ADB 设备和目标应用的 Launcher Activity，不依赖 SoloPi 控制协议、辅助功能或性能会话。

```bash
scripts/solopi-ai --pretty startup-time \
  --target-package "com.example.pay" \
  --mode cold \
  --iterations 5 \
  --interval 1 \
  --launch-timeout 30
```

| 参数 | 默认值 | 行为 |
|---|---|---|
| `--target-package` | 无 | 必填。CLI 通过 Package Manager 自动解析该包的 Launcher component，并拒绝其他包的解析结果。 |
| `--mode` | `cold` | `cold` 每轮使用 `-S` 强制停止目标应用；`warm` 每轮使用 `-R 2`，第一段预热，第二段测量。 |
| `--iterations` | `5` | 正整数测量轮数。 |
| `--interval` | `1` | 轮次间隔秒数，可为 `0`，必须是有限非负数。 |
| `--launch-timeout` | `30` | 每轮 `am start -W` 的正数超时秒数。 |

每轮必须同时满足 ADB 返回码为 `0`、无 Activity 启动错误、`Status=ok`、存在 `Complete`，并严格解析以下字段：

| 字段 | 含义 |
|---|---|
| `LaunchState` | 安卓实际报告的 `COLD`、`WARM` 或 `HOT`；`--mode` 决定是否强停，最终解释以该字段为准。 |
| `Activity` | 实际启动的 Activity component，必须仍属于 `--target-package`。 |
| `ThisTime` | 最后一个 Activity 的启动耗时，单位毫秒；系统未提供时为 `null`。 |
| `TotalTime` | 本次 Activity 启动链总耗时，单位毫秒。 |
| `WaitTime` | `am start -W` 等待完成的总时间，单位毫秒。 |

成功结果包含全部逐轮 `samples`，并对 `ThisTime`、`TotalTime`、`WaitTime` 分别输出 `available`、`sampleCount`、`min`、`max`、`mean`、`median`、`p90`；P90 使用最近秩口径。任一轮必需字段缺失、字段重复或无效、包名不匹配、启动失败或超时，整次命令均返回失败；错误上下文可包含此前完成的样本，但不会生成基于部分轮次的 `statistics`。

部分新版安卓系统可能不再返回 `ThisTime`。Pixel 8 的 Android 16 已确认会省略该字段；CLI 将逐轮 `ThisTime` 输出为 `null`，其统计项返回 `available=false`、`sampleCount=0` 和空统计值。CLI 不会用 `TotalTime` 猜测或替代它。需要跨系统对比时，应先确认各设备实际支持的字段口径。

`warm` 使用 Activity Manager 自带的 `-R 2` 重复启动：第一段建立暖进程，系统在重复前结束顶层 Activity，第二段才是统计样本。这样不会把 Intent 仅交给当前最前台实例的 `UNKNOWN` 结果算作暖启动。报告时仍保留第二段真实 `LaunchState`，不得把请求模式改写成系统实测状态。

该结果不是视觉完成时间。需要包含渲染和业务页面变化的口径时，使用独立录屏后的 `video-analysis-*`，或用例内的 `startRecordScreen`/`stopRecordScreen` Provider；两者都依赖 MediaProjection 和 `hulu_screenRecord` 插件。对比数据前必须明确选用哪一种，不能直接混合统计。

## 性能历史

| 命令 | 用途 | 成功条件 |
|---|---|---|
| `perf-history-list --limit <1..500>` | 列出有界历史摘要，默认 `100` 条 | 返回响应有效，每条后续操作使用它的不透明 `id` |
| `perf-history-get --id <id>` | 查询一条准确历史详情 | 响应 `id` 与请求完全匹配 |
| `perf-history-delete --id <id>` | 删除一条准确历史 | 准确删除回执达到成功终态且退出码为 `0` |

`perf-history-delete` 默认删除超时为 `30` 秒、轮询间隔为 `0.2` 秒，且不可逆。先使用 `perf-history-get` 保存需要的详情，并获得用户对准确 `id` 的删除意图。不得用时间、包名、列表位置或最新记录代替 `id`。

历史命令只管理原始记录。性能阈值、聚合方式、稳定区间、基线对比和图表仍不由 CLI 自动化；需要分析时先与用户确认口径，不得从历史数量推断达标。

## 压力测试边界

压力命令只提供有界 CPU 与内存负载，不提供任意 Shell。每个启动都必须设置有限持续时间并保存新的 `sessionId`。

| 参数 | 设备端边界 |
|---|---|
| CPU 线程数 | `0` 到设备在线处理器数；启用 CPU 压力时必须大于 `0`。 |
| 单线程 CPU 百分比 | `0` 到 `100`；与 CPU 线程数必须同时为零或同时大于零。 |
| 内存兆字节数 | `0` 到 `2048`。 |
| 持续秒数 | `1` 到 `3600`，默认 `60`。 |

CPU 与内存至少启用一种。使用 `stress-start --help` 核对当前 CLI 参数名，不得用 Shell 绕过边界。

状态流转：

```text
idle -> starting -> running -> stopping -> stopped
       \---------------------> failed
```

设备端会在持续时间到达时按同一 `sessionId` 自动停止，并依次把 CPU 线程数、CPU 百分比和内存负载归零。自动停止是最后防线，不替代调用方清理：

1. `stress-start` 后保存 `sessionId`，确认 `state=running`。
2. 执行业务用例；不要并发启动第二个压力会话。
3. 在正常结束、失败、超时、取消和中断的统一清理路径中，先运行准确的 `stress-status`。
4. 会话仍活动时运行 `stress-stop`，确认 `state=stopped`。
5. 无法确认停止时立即报告设备可能仍受压，停止后续性能或稳定性测试。

不要停止手工性能面板或其他智能体创建的负载。状态返回不同 `sessionId` 时停止归因，不得用最新会话冒充本次会话。

## 权限与并发

- 性能和压力启动可能依赖 SoloPi 内部 ADB、省电配置、悬浮窗或所选指标声明的权限。
- 不得自动点击权限弹窗、启用辅助功能或修改系统安全设置。报告错误，由用户完成一次性配置。
- 同一个 SoloPi 进程中，同类活动会话只允许一个所有者。性能采集不要与手工性能面板并发；压力测试不要与未知压力来源并发。
- 性能采集自身会产生开销，压力测试更会显著改变设备温度、耗电和调度。报告指标集合、压力参数和持续时长。

## 失败恢复

| 现象 | 处理 |
|---|---|
| 指标不支持 | 重跑 `perf-list`，只使用本次响应的键。 |
| 性能或压力会话冲突 | 查询状态；只有能证明属于本任务时，才用准确 `sessionId` 停止。 |
| 启动确认超时 | 使用错误中保留的 `sessionId` 查询；已活动则继续原流程或清理，仍在启动则请求停止，不得盲目重启。 |
| 性能状态预检明确不可达 | 只对调用方已经保存的准确 `sessionId` 执行 `perf-stop`。CLI 会发送一次类型化停止并有限轮询；仅 `recoveredWithoutPreflight=true` 且同一会话到达终态才表示恢复完成。 |
| 会话标识不匹配 | 保存期望标识和最新状态，停止归因，不得操作最新的其他会话。 |
| 停止超时 | 继续查询同一标识；活动期间不开始新会话。 |
| `state=failed` | 报告 `error`；性能失败不代表数据已保存，压力失败也不自动证明负载已经清零。 |
| 性能输出已存在 | 改用新目录，不得删除或覆盖旧证据。 |
| ADB 拉取失败 | 保留设备端路径与状态，修复连接后核验；不得伪造本地产物。 |

更多权限、超时和中断恢复见 [故障处理](troubleshooting.md)。
