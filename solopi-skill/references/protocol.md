# SoloPi 控制协议

## 传输边界

CLI 只组合受约束的本地传输：

| 传输 | 用途 | 边界 |
|---|---|---|
| 纯本地 | `actions`、`case-template`、`case-validate`、`case-step-*`、`perf-analyze` | 不选择设备，不改变设备。 |
| 受保护 ADB Activity | 内部 ADB 连接初始化、回放/取消、动态 Agent start/act/pause/resume/end/cancel、配置修改、用例导入/删除、历史删除、交互录制、性能、压力、独立录屏、视频分析和插件变更 | 显式组件要求系统 `android.permission.DUMP`，只有 ADB shell 可启动；普通 App、网页深链和 HTTP 均被拒绝。 |
| ADB 转发后的 HTTP | 能力、健康、内部 ADB 连接回执、动态 Agent observe/status/receipt/timeline、应用、用例、页面、回放/历史、配置、插件列表以及各会话状态与回执 | 只允许查询。CLI 创建临时本机端口转发，结束时移除。 |
| 受限 ADB 文件 | 截图、日志、用例/插件暂存推送、性能目录与录屏 MP4 拉取 | 参数由类型化命令生成，校验规范子路径，不暴露任意命令执行。 |

设备端控制服务默认监听 `23342`。不得通过 Wi-Fi 或设备局域网地址连接，也不得自行调用 `/scheme/...`、拼接深链或暴露任意 Shell。若查询端点收到变更请求，设备端必须返回明确拒绝。

用例 JSON 不放入 URI。CLI 先本地规范化，再推送到应用专属导入目录，携带新的 `requestId` 调用受保护 ADB Activity，并从只读通道获取准确回执。

## 标识与所有权

| 标识 | 所有对象 | 规则 |
|---|---|---|
| `requestId` | 回放启动、内部 ADB 连接、用例导入/删除、历史删除、视频分析、插件安装/移除等一次性请求 | 每次请求新建；只接受同一 ID 的回执。最新回执不匹配时不得视为成功；同名回放也不能跨请求认领。 |
| `caseId`、`caseFingerprint` | 回放前已校验的用例快照 | `case-get` 返回数据库 ID 与小写 SHA-256 指纹；指纹覆盖外部步骤文件实际加载、解密并内联后的完整内容。启动回放必须同时携带，设备按 ID 精确查询并重新构建快照。名称、ID、步骤内容或指纹任一不匹配时拒绝启动。 |
| `runId` | 单次回放 | 每个已受理回放唯一；状态、结果、取消和证据必须绑定同一 ID。取消只能使用启动命令为本任务返回的原始 ID。 |
| `sessionId` | 交互录制、性能实时监控与采集、压力测试、独立录屏、相机扫码 | 启动前由 CLI 新建；状态与停止或取消必须精确匹配。不得停止或取消未知所有者会话。 |
| `sessionId` + `ownerToken` | 动态 Agent 会话 | `sessionId` 定位会话，启动命令返回的不可猜测 `ownerToken` 证明所有权；两者必须同时匹配才能 act、pause、resume、end 或 cancel。令牌不写入证据时间线。 |
| `observationId` | 动态 Agent 的单帧 UI 观察 | act 只能消费当前且 UI 签名未变化的观察。新 observe、已接受动作或页面变化都会使旧值不可执行。 |
| `stepId` | 动态 Agent 的单个动作 | 会话内唯一且幂等；重复提交返回原 typed receipt，绝不再次执行动作。 |
| `taskId + shardId + attemptId + deviceId + leaseId + ownerGeneration` | 主机托管 assignment | 标识一次持久调度归属；heartbeat、结果提交和释放必须全量匹配。新 claim 会递增 `ownerGeneration`，旧 Worker 的迟到写入被 fencing 拒绝。 |
| `id` | 回放或性能历史记录 | 仅使用 `*-history-list` 返回的不透明值；详情和删除必须精确匹配。 |
| `pluginId` | 已安装插件 | 仅使用 `plugin-list` 返回的稳定值；移除时不得用名称、版本或文件路径代替。 |

Android `sessionId`、动态 Agent generation 和部分回执保存在 SoloPi 应用进程内，
应用重启后不能依赖旧标识，也不得并发发送会互相覆盖回执的变更。主机控制面的
task、shard、attempt、assignment 和 append-only event 则持久化在 SQLite；两类
状态不能互相替代。标识不匹配、缺失或被新会话替换时，停止结果归因并保留最新
响应用于诊断。

普通配置修改没有长期会话。CLI 通过受保护 ADB Activity 写入后，必须经 HTTP 读取同一键并比较规范化值；查询结果不匹配时，修改未获确认。配置允许列表中有 17 个 CLI 可写项；性能数据上传地址、录屏上传地址、远程插件源、内部 ADB 地址、全局参数、加密密钥、数据根目录和控制端口共 8 项固定为 `writable=false`，只能在 App 界面处理，敏感值始终脱敏。

## 状态机

### 内部 ADB 连接

```text
connecting -> connected
           -> failed
```

`adb-connect` 只在 `doctor` 的唯一缺失项为内部 `adb` 时启动。受保护 Activity 立即记录新 `requestId` 的 `connecting` 回执，后台调用 SoloPi 既有连接器；HTTP 只读查询 `adb-connect-status`。只有 `connected=true`、随后完整 `doctor.ready=true` 且退出码为 `0` 才算门禁通过。`failed` 必须返回稳定错误码和 `userActionRequired`；CLI 不接受 RSA 弹窗、不修改内部地址，也不执行 `adb tcpip 5555`。

### 回放

```text
idle -> running -> passed
                -> failed
                -> cancel_requested -> cancelled
```

`passed`、`failed`、`cancelled` 是终态。请求已受理或 `running` 不是成功终态。`run --no-wait` 的退出码 `0` 只表示处于活动状态。

CLI 在安全预检时读取准确用例并保存 `caseId` 与 `caseFingerprint`。读取时 App 将外部步骤文件实际加载、解密并内联，指纹覆盖这份完整内容。启动请求同时携带新的 `requestId`、名称、ID 和指纹；App 只按 ID 重建一次当前快照并校验名称与指纹，随后直接回放该内联副本，不再按 `storePath` 读取。预检后发生同名替换、字段修改或步骤文件原地改写时进入失败终态，不能继续按名称回放旧结论。

状态回执同时返回 `requestId` 与 `runId`。CLI 只有在请求 ID 与本次启动完全一致时才能认领运行；若另一个客户端在竞态中启动同名用例，必须报告所有权冲突，不能仅凭新运行 ID 和相同名称接管。

取消回放必须使用启动命令为本任务返回并保存的原始 `runId`，不能把查询到的任意当前活动 ID 当作所有权证明。设备只允许状态仍为 `running` 且标识完全匹配的请求进入 `cancel_requested`；旧任务的迟到取消不得作用于后续回放。权限回调到达前取消时，设备直接发布同一 `runId` 的 `cancelled` 终态并释放会话。

### 动态 Agent

```text
active <-> paused
active -> acting -> active
active/paused/acting -> ended | cancelled | failed | expired
```

`agent-session-start` 原子取得与用例回放共享的设备控制租约，并在返回前等待首帧 observation。`agent-observe` 刷新辅助功能树，为该帧生成 `nodeId`，返回树 SHA-256、可用时的截图路径与 SHA-256；截图不可用时返回明确 `screenshotError`，不会伪造哈希。

验证控制层可在这张首帧到达后调用 `DecisionProvider`，并在每次动作得到新的
settled observation 后再次调用。DecisionProvider 只输出 Action Proposal
（`act/done/blocked`），没有设备调用、租约管理或结果裁决权限。它与 Android
用例系统中由三个 `ActionProvider` 实现发布的 6 个性能、录屏和图片动作契约不是
同一扩展点；动态 Agent proposal 仍只允许下述 7 个 typed action。

动态 Agent CLI 会在启动控制服务或调用受保护的 ADB 写入口后恢复命令前的前台 Activity。设备端只接受达到可操作窗口尺寸且不是 SoloPi 控制页的根节点，短暂切换期间会等待目标窗口恢复，不会把状态栏等窄系统窗口发布为 observation。

`agent-act` 必须同时携带准确 `sessionId`、`ownerToken`、新 `stepId` 和当前 `observationId`。设备执行前再次刷新树并比较签名；旧观察、已消费观察、另一会话或另一 owner 的请求均在调用 `OperationService` 前拒绝。动作仅允许 `click`、`longClick`、`input`、`back`、`home`、`scroll`、`wait`，由显式映射复用 `OperationService`；不接受 `PerformActionEnum` 名称、任意 Shell、Provider、清数据、进程控制或任意 Scheme。

动作先产生 `accepted` receipt，完成后等待 UI 签名稳定，再发布 `succeeded` receipt 和新的 settled observation；验证错误为 `rejected`，执行或 settle 错误为 `failed`。相同 `stepId` 的重试只返回已保存 receipt，因此协议内不会主动执行第二次；但进程失联、网络中断或租约切换时，真实点击等物理副作用可能已经发生而 receipt 尚未持久可见，系统不承诺 UI 副作用 exactly-once。恢复方必须重新 observation 和判定页面，而不是盲目重发最后动作。`maxSteps`、`maxDurationMs`、`idleTimeoutMs`、连续重复动作和无进展阈值均由设备端执行，不能靠客户端关闭。暂停状态允许查询和 observe，但拒绝 act，恢复后才能继续。

每次状态变化追加到 `agent-sessions/<sessionId>/timeline.jsonl`，事件 sequence 单调递增，包含 generation、step/observation 引用、typed action/receipt 和证据路径。这里的 `generation` 防止 Android App 进程内旧会话异步回调命中新会话；它不同于主机调度的 `ownerGeneration`。正常 end、cancel、预算或循环失败、总时长/空闲 watchdog、动作异常都会进入不可逆终态并恰好释放一次共享租约。CLI 在 start/act 的超时或中断路径尽力精确 cancel，设备 watchdog 是客户端进程消失后的最终清理保证。

### AI 验证计划

验证计划是 CLI 本地控制层，不新增 Android 变更接口。`verify-compile` 将稳定
步骤和 checkpoint Oracle 编译成固定用例，把未知步骤保留为有预算的动态
Agent segment；`verify-run` 依次复用现有 case import/replay 与 Agent 协议。
Oracle 在这里是 checkpoint 的 selector、field、operator 和 expected 预期规则，
不是数据库或 Agent 自评。

计划以 `planFingerprint` 绑定完整 Goal Tree、Test Intent IR、场景 DAG、用例和
Oracle。设备执行前 `verify-validate` 必须重新计算指纹并校验动作白名单。
固定回放的 `exceptionStepId` 只有准确命中编译 Oracle step 时才归因为产品
失败；无法归因或证据缺失为 `not_tested`，不能猜测结果。

外部 Agent 的 `done` 是控制事件，不是结果事件。验证引擎中的 Result Judge 是
唯一最终裁决主体：它汇总 checkpoint 的确定性 Oracle 结果、依赖、前置条件、
执行证据和 required cleanup，全部通过才为 `passed`，确认不匹配或 required
cleanup 失败为 `failed`，未到达、证据缺失或不可可靠归因为 `not_tested`。
`not_tested` 不是笼统的 Oracle 失败。统一报告通过 `evidenceRefs` 关联固定回放、
Agent observation/timeline 和清理证据。

### 托管任务与设备 generation

```text
task:  queued -> running -> passed | failed | not_tested | cancelled
shard: queued -> leased -> running -> passed | failed | not_tested | cancelled
                         \-> retryable_failed -> queued
attempt: leased -> running -> terminal
```

控制面为每次 claim 原子生成 `attemptId`、随机 `leaseId` 并递增设备
`ownerGeneration`。heartbeat、完成、失败和释放必须同时命中准确 task、shard、
attempt、device、lease 与 generation；取消或租约过期会先 fence 旧 assignment，
迟到回调不能修改 successor。task/shard 一旦终态不可逆。

Worker B 不会接管 Worker A 的内存、Android `sessionId` 或半完成调用。A 停止
heartbeat、lease 过期并完成 recover 后，B 重新 claim 持久化 shard，获得新的
attempt/lease/`ownerGeneration`，读取提交时保存的 plan、decisions 和目标 serial，
并以新 Android session 从测试入口重新运行。A 的旧 events/evidence 只用于审计，
不用于恢复执行现场。fencing 只保证 A 的迟到 heartbeat、结果或释放不能污染 B 的
assignment；它不撤销 A 可能已经造成的 UI 物理副作用，也不提供 exactly-once
触摸语义，因此新 attempt 仍须重新执行前置检查和当前页面判定。

相同 `idempotencyKey` 只有在执行内容指纹和 owner token 都一致时返回原 task；
内容不同为冲突，owner 不同为拒绝。过期租约和基础设施失败按任务预算有界退避
重试，确定性验证结果不自动重试。事件只追加且 task 内序号连续，所有持久化
内容先进行 secret redaction。

HTTP 控制面默认只绑定 loopback；`/health` 外的资源必须提供 Bearer token，任务
取消还必须提供独立 owner token。HTTP 只管理控制面数据，真实执行由 worker
claim 后复用 `verify-run`，不能通过 API 直接调用设备动作。

### 交互录制

```text
idle -> starting -> recording -> stopping -> stopped
       \-----------------------> failed
```

只有 `recording` 表示用户可开始手工触控；只有 `stopped` 表示停止流程完成。录制依赖用户真实操作，状态机不能证明业务步骤已经按预期录入。

### 独立录屏

```text
idle -> pending-user-confirmation -> starting -> recording -> stopping -> stopped
                                     \-------------------------------> failed
```

`pending-user-confirmation` 表示 Android MediaProjection 系统弹窗需要用户确认，不是录屏已开始。只有编码器真实回调后才进入 `recording`；只有输出位于 `capturesRoot`、MP4 已关闭且文件非空才进入正常 `stopped`。

调用方可在 `pending-user-confirmation` 或尚未开始编码的 `starting` 阶段使用原 `sessionId` 停止。此时返回 `cancelledBeforeStart=true`，不要求 MP4；旧会话迟到的权限、服务连接或自动停止回调都不得命中新会话。Android 没有安全公开接口代替用户关闭已显示的系统弹窗。

### 相机扫码

```text
idle -> starting -> pending-camera-permission -> scanning -> completed
       \---------------------------------------> cancelled
       \---------------------------------------> failed
```

`pending-camera-permission` 表示等待用户在设备上处理相机权限，`scanning` 表示相机已经就绪、仍需用户完成取景；两者都不是业务成功。只有 `completed` 返回非空 `content`、ZXing `format` 和 SoloPi `codeType`。协议扫描分支必须在手工页面的 URL/Scheme 跳转之前结束处理，所有状态固定 `contentExecuted=false`。

手工扫码页面和协议会话使用互斥相机所有权。启动、查询和取消都绑定 CLI 创建的 `sessionId`；标识不匹配时不得关闭页面。用户关闭页面或调用方用准确 ID 取消会进入 `cancelled`，相机权限或初始化错误进入 `failed`。HTTP 仅查询 `action=status`，启动和取消只允许受 DUMP 保护的 ADB Activity。

### 视频差分分析

```text
request accepted -> analyzing -> completed
                              -> failed
```

每次启动由 CLI 生成 `requestId`。设备只接受 SoloPi `ScreenCaptures` 目录的直属非空 MP4、显式动作偏移和 `0..1` 范围内的正差异阈值；同一时间只允许一个分析。插件缺失、路径拒绝、并发冲突和调度异常也必须保存为该 `requestId` 可查询的失败回执，不能让调用方只看到超时。只有 `completed` 的 `visualResponseTimeMs` 才是有效视觉响应耗时。

### 性能采集

```text
idle -> starting -> recording -> stopping -> stopped
       \-----------------------> failed
```

`stopped` 表示设备保存完成，不表示性能达标。输出目录只在停止成功后发布。

### 性能实时监控

```text
idle -> starting -> running -> stopping -> stopped
       \---------------------> failed
```

实时监控与性能采集共享指标服务，只允许一个所有者。启动通过受保护 ADB Activity 原子取得显示项租约；HTTP 只查询 `mode=display&action=status`。状态返回 `sampledAt`、`ownedDisplayNames` 和租约绑定的 `values`。停止必须携带原 `sessionId` 和同一底层租约；清理不完整时保持 `stopping` 并仅通过布尔字段 `stopRetryable` 授权有限重试。旧 UI、过期会话和名称相同的新实例均不能停止或读取该租约。

### 压力测试

```text
idle -> starting -> running -> stopping -> stopped
       \---------------------> failed
```

压力会话带最大持续时间，设备端到时应自动清零 CPU 与内存负载。调用方仍必须查询原 `sessionId` 并确认终态；业务失败、CLI 超时和中断都不能跳过停止。

### 插件变更

```text
in_progress -> completed_restart_required
            -> failed
```

`plugin-install` 和 `plugin-remove` 使用新 `requestId` 并按该 ID 轮询回执。`completed_restart_required` 是成功终态，但只表示注册表与文件变更已完成，必须重启 SoloPi 才能完整激活或移除运行时代码。不得把 `in_progress` 或“重启前的当前进程”作为新插件能力已生效的证据。

## 多运行编排

`run-repeat` 和 `run-batch` 在客户端编排多个独立 `run`，而不是把多个执行压缩成一个模糊的最新状态。

- 每个子运行保留独立 `runId`、用例名、序号、状态和结果。
- 同一 SoloPi 进程不并发启动子运行。
- 汇总成功要求所有请求的子运行都达到 `passed`；失败后是否继续由显式参数决定。
- 超时或中断时先恢复当前活动子运行，再决定是否继续后续项。

## 查询契约

主要查询结果：

- 用例预检：`caseId`、`caseName`、`caseFingerprint` 和完整步骤数据。
- 回放：`requestId`、`runId`、`caseName`、`state`、`active`、`terminal`、起止时间、`error` 和 `results[]`。
- 内部 ADB：`requestId`、`state`、`connected`、`terminal`、`userActionRequired`、`requiredUserAction` 和错误字段。
- 回放失败：`results[].exceptionMessage`、`exceptionStep`、`exceptionStepId`。
- 会话：`sessionId`、`state`、`active`、`terminal`、配置参数、起止时间和 `error`；性能实时监控另含 `running`、`sampledAt`、`ownedDisplayNames`、`runningItems` 和租约绑定的 `values`。
- 动态 Agent：会话字段加 `generation`、`acceptedSteps`、`observationId`、`leaseHeld`；observation 含树、树/截图哈希与帧内 `nodeId`；receipt 含 step、输入观察、typed action、状态、错误和 settled observation。
- 托管执行：task/shard 状态、准确 assignment 六元身份、设备 generation/健康/能力、append-only event sequence、attempt failure category、矩阵状态、证据 digest 和稳定 exit code。
- 历史：不透明 `id`、类型、时间、摘要和受控文件信息；列表只返回请求的有界条数。
- 独立录屏：会话字段加 `userActionRequired`、`cancelledBeforeStart`、`capturesRoot`、`outputPath` 和 `fileSize`。
- 视频分析：`requestId`、`state`、`videoPath`、`actionOffsetMs`、`differenceThreshold`、`visualResponseTimeMs` 和错误字段。
- 插件：`pluginId`、版本、加载状态、依赖、可移除性；变更回执加 `requestId`、`state`、SHA-256 和 `restartRequired`。
- 变更回执：`requestId`、目标对象、实际变更数量和错误。

响应中的 `success=true` 只表示本次查询或命令阶段成功。仍需按对象状态判断业务是否完成。

## 退出码

| 代码 | 含义 |
|---|---|
| `0` | 请求约定的成功条件已经满足；异步回放例外，仅表示已受理并活动。 |
| `2` | 控制框架未就绪、业务终态失败/取消、会话冲突或设备拒绝。 |
| `3` | 本地用法、设备选择或参数错误。 |
| `4` | ADB、HTTP 或协议响应错误。 |
| `124` | 确认、运行、保存或停止超时；设备端操作可能仍活动。 |
| `130` | 调用方中断；动态 Agent start/act 会尽力精确 cancel，其他活动会话仍须按各自标识清理。 |

`managed-report` 对矩阵终态使用更细的 CI 映射：`passed=0`、`failed=2`、
`not_tested=3`、非终态或控制错误 `=4`、`cancelled=130`。

正常命令和已处理错误向标准输出写一个 JSON 对象。参数解析错误由命令行解析器输出文本，不属于 JSON 契约。

## 证据所有权

`run --artifacts <dir>` 保存 `result.json`、`screen.png`、`logcat.txt`。同步终态或超时时会尽力采集；异步模式需要终态后单独取证。证据目录必须绑定准确 `runId`，不能用较新运行的文件替代。该命令不读取 App 历史页的完整结果目录，不能替代按历史 `id` 导出全部截图、完整日志和其他附件；当前 CLI 尚未开放这种完整历史导出。

`perf-stop --output <dir>` 只拉取准确 `sessionId` 发布的会话目录，拒绝设备根外路径和已有本地目录，并校验 CSV 存在。`screen-record-stop --output <file>` 只拉取同会话在 `capturesRoot` 下发布的非空 MP4，拒绝根外路径和无安全覆盖意图的已有本地文件。`video-analysis-start` 只消费同一受控目录中的设备端 MP4，不接受拉取后的任意本地路径，也不自动外发视频或结果。

`plugin-install` 的本地 ZIP 先由 CLI 计算 SHA-256，再以受控随机名称推送到应用导入目录；安装回执无论成功、失败或调用方中断，CLI 都必须尝试删除该暂存文件。插件、性能数据、截图、日志、录屏和用例可能包含敏感或可执行内容，不得自动上传或外发。

动态 Agent 的 `agent-timeline` 返回内存中的有序事件和设备端 `timelinePath`。完整回放证据至少应包含首帧 observation、每个 step 的 action/receipt、settled observation 和最终 terminal/lease release 事件。`ownerToken` 是控制凭据，只在调用方安全上下文保存，不进入 JSONL、截图名或业务日志。

托管报告把每个 shard 的所有 attempt、验证 outcome fingerprint、artifact path 和
evidence digest 绑定到 assignment。每个最终结论必须能沿同一次执行的
`planFingerprint -> taskId/shardId/attemptId -> sessionId/observationId/stepId ->
typed receipt -> settled observation -> append-only timeline -> checkpoint/cleanup ->
Result Judge -> report/evidence digest` 反向定位；不能借用另一 attempt、旧 Worker、
上一次 run 或独立性能会话的数据补成通过。

`outcomeFingerprint` 是排除时间、run ID 和本机路径的裁决摘要，用于比较相同计划
的结果状态是否一致；它不包含完整证据来源，不能替代 same-run identity chain，
也不能单独证明两份 artifact 属于同一次执行。保留期后可清理原始文件，但 digest、
Oracle/checkpoint 规则与 Result Judge 结果、assignment receipt 继续保留。HTTP
Bearer 与任务 owner token 均不得写入事件、报告或 artifact 名称。
