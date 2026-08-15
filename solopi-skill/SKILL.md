---
name: solopi-ai
description: 通过 SoloPi 的机器可读 CLI 编译和执行 AI 验证计划，管理签名端侧 ExecuTorch 决策模型、持久设备池、无人值守任务、安卓设备、应用、动作、配置、用例步骤与交互录制、回放及性能历史、动态 Agent、批量与重复执行、性能监控、压力测试和证据。适用于需求/AC 到 Result Judge 三态结论、cloud/on-device 决策切换、模型发布门禁，以及 generation 租约的多设备 CI 执行。
---

# SoloPi AI 控制框架

将本文件所在目录作为 Skill 根目录。只使用 Skill 的薄入口：

```bash
scripts/solopi-ai --pretty <命令>
```

执行时把 `scripts/solopi-ai` 解析为绝对路径，并保持调用者当前工作目录不变。该入口调用同级 `solopi-harness-cli` 的核心实现；独立安装时可通过 `SOLOPI_HARNESS_CLI` 指向准确 CLI。不得调用仓库根目录下的兼容脚本，也不得自行拼接 HTTP、Scheme 或 Shell 命令代替类型化 CLI。

全局参数必须放在子命令前。多台设备在线时，每次调用都必须添加 `--serial <adb-serial>`。

## 能力路由

需要判断某项 App 能力是直接 CLI、用例间接、用户交互还是暂不可安全自动化时，先读取 [能力矩阵](references/capability-matrix.md)。需要证明页面、设置和动作是否已纳入覆盖时，再读取 [App 功能覆盖清单](references/app-feature-inventory.md)。

| 用户意图 | 使用命令 | 必须读取 |
|---|---|---|
| 检查设备、恢复内部 ADB、查询版本和协议 | `doctor`、`adb-connect`、`capabilities`、`app-info`、`app-status` | [故障处理](references/troubleshooting.md) |
| 发现被测应用与动作 | `apps`、`actions` | [CLI 参考](references/cli-reference.md)、[动作目录](references/action-catalog.md) |
| 查询或修改配置 | `config-list`、`config-get`、`config-set` | [CLI 参考](references/cli-reference.md)、[协议](references/protocol.md) |
| 启动、观察或停止交互录制 | `record-start`、`record-status`、`record-stop` | [CLI 参考](references/cli-reference.md)、[故障处理](references/troubleshooting.md) |
| 查询、导出或删除用例 | `cases`、`case-get`、`case-delete` | [CLI 参考](references/cli-reference.md) |
| 创建、校验或导入用例 | `case-template`、`case-validate`、`case-import` | [用例编写](references/case-authoring.md)、[动作目录](references/action-catalog.md) |
| 查看或编辑导出用例的步骤 | `case-step-list`、`case-step-add`、`case-step-update`、`case-step-delete`、`case-step-move`、`case-step-copy` | [用例编写](references/case-authoring.md)、[动作目录](references/action-catalog.md) |
| 获取当前页面和真实选择器 | `inspect` | [用例编写](references/case-authoring.md) |
| 单次同步或异步回放 | `run`、`status`、`result`、`cancel` | [协议](references/protocol.md)、[CLI 参考](references/cli-reference.md) |
| 动态 Agent 观察、类型化动作、暂停与清理 | `agent-session-start`、`agent-observe`、`agent-act`、`agent-status`、`agent-timeline`、`agent-pause/resume/end/cancel` | [协议](references/protocol.md)、[CLI 参考](references/cli-reference.md) |
| 从需求/AC 编译并执行可复现验证 | `verify-normalize`、`verify-compile`、`verify-validate`、`verify-run` | [验证工程](references/verification-engine.md)、[CLI 参考](references/cli-reference.md) |
| 持久设备池、任务队列、矩阵调度和 CI/API 托管执行 | `managed-*` | [托管执行与设备池](references/managed-execution.md)、[协议](references/protocol.md) |
| 签名端侧模型安装、激活、回退、推理、基准与发布门禁 | `model-*`、`verify-run --decision-provider` | [端侧 Agent 模型部署](references/model-deployment.md)、[验证工程](references/verification-engine.md) |
| 重复或批量回放 | `run-repeat`、`run-batch` | [CLI 参考](references/cli-reference.md)、[协议](references/protocol.md) |
| 回放历史的列表、详情与删除 | `replay-history-list`、`replay-history-get`、`replay-history-delete` | [CLI 参考](references/cli-reference.md)、[协议](references/protocol.md) |
| 性能指标、实时监控和采集会话 | `perf-list`、`perf-current`、`perf-display-start/status/stop`、`perf-start/status/stop` | [性能测试](references/performance-testing.md) |
| 本地性能 CSV 描述性统计 | `perf-analyze` | [性能测试](references/performance-testing.md) |
| 安卓应用冷启动或暖启动耗时 | `startup-time` | [性能测试](references/performance-testing.md)、[CLI 参考](references/cli-reference.md) |
| 性能历史的列表、详情与删除 | `perf-history-list`、`perf-history-get`、`perf-history-delete` | [性能测试](references/performance-testing.md)、[协议](references/protocol.md) |
| CPU 或内存压力测试 | `stress-start`、`stress-status`、`stress-stop` | [性能测试](references/performance-testing.md)、[故障处理](references/troubleshooting.md) |
| 独立录屏会话与 MP4 证据 | `screen-record-start`、`screen-record-status`、`screen-record-stop` | [CLI 参考](references/cli-reference.md)、[故障处理](references/troubleshooting.md) |
| 相机扫码会话与只读内容 | `scan-start`、`scan-status`、`scan-cancel` | [CLI 参考](references/cli-reference.md)、[协议](references/protocol.md)、[故障处理](references/troubleshooting.md) |
| 录屏视频差分视觉响应耗时 | `video-analysis-start`、`video-analysis-status` | [性能测试](references/performance-testing.md)、[CLI 参考](references/cli-reference.md) |
| 插件列表、本地安装与精确移除 | `plugin-list`、`plugin-install`、`plugin-remove` | [CLI 参考](references/cli-reference.md)、[故障处理](references/troubleshooting.md) |
| 独立采集截图或日志 | `screenshot`、`logs` | [CLI 参考](references/cli-reference.md) |

`actions`、`case-template`、`case-validate`、`case-step-*`、`perf-analyze`、`verify-normalize`、`verify-compile` 和 `verify-validate` 是纯本地操作。`verify-run` 与其他 SoloPi 协议设备操作首次执行前先运行 `doctor`；`startup-time`、`screenshot` 和 `logs` 只要求 ADB 设备，不要求 SoloPi 控制协议或内部权限就绪。

## 通用执行规则

1. 设备命令先运行 `doctor`；纯本地的 `actions`、`case-template`、`case-validate`、`case-step-*` 和 `perf-analyze` 不连接设备，可直接执行。`doctor` 必须核对内部 ADB、悬浮窗、电池优化白名单和辅助功能；`background` 只是 App 的提示型状态。若唯一缺失项为内部 `adb`，使用 `adb-connect` 发起 SoloPi 自身连接并等待准确 `requestId` 的终态，再以命令返回的完整 `doctor` 为门禁。存在其他缺失项时停止设备变更并报告，不得静默授权。
2. 运行 `capabilities`，只调用设备声明支持的 SoloPi 协议命令；`startup-time` 是当前 Skill CLI 内置的固定 ADB 能力，不属于设备控制协议。
3. 查询真实数据：应用用 `apps`，内置动作契约用 `actions`，用例用 `cases`，性能指标用 `perf-list`。`actions` 不访问设备，也不会发现插件额外注册的入口或 Provider；不得猜测包名、动作、用例名或指标键。
4. 保存每次变更和回放启动使用的 `requestId`，以及回放的 `runId`、性能/录制/压力/独立录屏操作的 `sessionId`、历史记录的不透明 `id` 和插件的稳定 `pluginId`。后续查询、停止或删除必须使用原标识；标识不匹配时停止归因。
5. 只有对应状态机的成功终态和退出码同时满足要求，才能报告完成。ADB 已接受、请求已受理或会话仍活动都不是业务成功。
6. 超时或中断后，先查询准确标识对应的状态，再停止属于本任务的活动会话；未确认清理完成前不得启动同类新会话。

SoloPi 设备状态变更经受 `android.permission.DUMP` 保护的显式 ADB Activity 发送；普通 App、网页深链和 ADB 转发后的 HTTP 不能进入该变更通道。HTTP 只用于查询。`adb-connect` 只调用 SoloPi 既有的内部连接流程，不接受 RSA 弹窗、不修改内部地址、不执行 `adb tcpip 5555`。`startup-time` 只允许内部固定的 Launcher 解析和 `am start -W` 命令。CLI 不提供任意 Shell、任意 Scheme、任意 HTTP 或 Wi-Fi 直连设备端口的后门。

## 动态 Agent

动态任务先执行 `agent-session-start` 并保存输出中的 `sessionId`、`ownerToken` 和首帧 `observationId`。每步只从该 observation 的真实 `nodeId` 中选择目标，以新的 `stepId` 调用 `agent-act`；下一步使用 receipt 中 settle 后的新 observation，或显式执行 `agent-observe`。收到 `stale_observation` 时必须重新观察和决策，不能把旧节点或旧动作盲目重放。

只使用 CLI 发布的 `click`、`longClick`、`input`、`back`、`home`、`scroll`、`wait`。动态协议不接受任意 Shell、Provider、枚举名、清数据或进程控制。正常完成用原身份执行 `agent-end`，放弃或错误路径执行 `agent-cancel`；暂停期间可 observe 和查询，但不能 act。最终用 `agent-timeline` 核对每个输入观察、typed action、receipt、settled observation、终态和租约释放事件。

## AI 验证工程

把需求/AC 交给验证工程时必须先读取[验证工程契约](references/verification-engine.md)。稳定步骤必须声明为 `operation` 并编译成固定 SoloPi 用例；只有选择器或路径未知的工作才声明为有预算的 `explore`。模型输出 `done` 只停止探索，不能写入 checkpoint 状态或最终结果。

执行前必须通过 `verify-validate`。JSON 字段 `oracle` 是 checkpoint 的确定性预期规则；
Result Judge 是唯一最终裁决主体。只有统一报告中所有 required checkpoint 都有本次运行
证据且 oracle 规则通过、required cleanup 也成功时，整体才可报告 `passed`；`failed` 与
`not_tested` 不得合并。复现性比较使用 `planFingerprint + outcomeFingerprint`，不比较
时间、run ID 或本机路径；`outcomeFingerprint` 只比较语义裁决，不代替同次运行证据身份。

## 托管执行

无人值守或多设备任务必须先读取[托管执行与设备池](references/managed-execution.md)。
提交后同时保存 `taskId` 和首次返回的 `ownerToken`；重复提交使用相同
`idempotencyKey + ownerToken`，取消也只允许原 owner。worker 只能执行控制面
返回的准确 serial 和 assignment，不能自行挑选设备或改写计划。

任务成功以 `managed-report` 的终态、稳定退出码和逐 shard 证据为准。
`queued/running`、单个 shard 通过或 worker 进程正常退出都不代表矩阵通过。
发生服务重启或网络中断时先恢复过期 generation；旧 assignment 的迟到结果
必须被拒绝，不能手工写回。

## 端侧模型

端侧决策前必须读取[端侧 Agent 模型部署](references/model-deployment.md)。模型包先
执行 `model-verify`，再按 install、benchmark、release-check、activate 顺序保存
每个 typed receipt。签名、摘要、兼容性或发布门禁失败时停止，不能换任意 key、
backend 或绕过 companion。模型 `done` 仍只能结束探索，最终结果只看 Result Judge
基于 checkpoint oracle、required cleanup 和本次运行证据形成的统一报告。

## 用例与回放

创建或修改用例前读取 [用例编写](references/case-authoring.md)；涉及动作时再读取 [动作目录](references/action-catalog.md)。基本闭环：

```bash
scripts/solopi-ai --pretty doctor
scripts/solopi-ai --pretty apps
scripts/solopi-ai --pretty actions
scripts/solopi-ai --pretty cases
scripts/solopi-ai --pretty case-get --case "payment-smoke" --output cases/payment-smoke.json
scripts/solopi-ai --pretty case-validate --file cases/payment-smoke.json --output cases/payment-smoke.import.json
scripts/solopi-ai --pretty case-import --file cases/payment-smoke.import.json
scripts/solopi-ai --pretty run --case "payment-smoke" --run-timeout 600 --artifacts artifacts/payment-smoke
scripts/solopi-ai --pretty result --run-id '<run-id>'
```

- 只把终态 `passed`、至少一条回放结果且退出码为 `0` 视为通过。
- `run --no-wait` 的退出码 `0` 只表示请求受理；继续用保存的 `runId` 查询。
- `run-repeat` 和 `run-batch` 是多个独立运行的编排。保留每个子运行的 `runId` 与结果；任一子运行失败时不得用汇总结果掩盖。
- `run`、`run-repeat` 和 `run-batch` 可用 `--target-package` 覆盖本次运行目标，用 `--restart-app` 或 `--no-restart-app` 覆盖本次重启策略；覆盖只作用于本次运行，不写回用例或全局设置。目标必须是已安装、具有 Launcher 且不能是 SoloPi 自身。
- `case-validate`、`case-import` 和所有 `run*` 命令会对整份用例应用相同安全策略：始终拒绝历史 `EXECUTE_SHELL`、内部 `HANDLE_PERMISSION_ALERT`、`HIDE_INPUT_METHOD` 和 Provider 上传 URL；`CLEAR_DATA`、`KILL_PROCESS`、`JUMP_TO_PAGE` 必须显式使用 `--confirm-high-risk`。前三项只能通过 `case-step-list` 查看，不能由 CLI 导入或回放。
- 回放前保存设备返回的准确 `caseId` 与 `caseFingerprint`；指纹覆盖从外部步骤文件实际加载、解密并内联后的完整内容，启动请求必须同时携带两者和新的 `requestId`。App 只执行该不可变快照；同名用例在预检后被替换、修改或原地改写步骤文件时必须失败，其他客户端的同名回放也不能被本次请求认领。
- 图片对比和用例内录屏动作只在所需插件已通过本地文件安装、重启并处于已加载状态时回放；缺失时停止并报告，不触发远程下载。
- 取消回放必须使用启动命令保存的 `runId`：`cancel --run-id '<run-id>'`。当前活动运行不匹配时停止，不能取消其他调用方的任务。
- 多参数用例不是 `run-batch`。先用 `case-get` 导出用例，再用 `case-validate --running-params-file <文件>` 写入并校验 `SEPARATE` 或 `UNION` 参数集合，最后通过 `case-import --replace` 更新准确用例；清除配置时使用 `--clear-running-params`。
- `case-delete` 是不可逆设备变更。先用 `case-get` 保存需要的副本，并获得用户对准确用例名的删除意图。
- 默认 `run` 会设置回放自动启动配置；不允许修改时使用 `--no-auto-start`，并先确认设备已启用该配置。

## 交互录制

`record-start` 只负责在准确应用上创建录制会话并进入可录制状态。业务触控、文本输入、页面跳转和结束时机由用户在手机上完成；CLI 不得伪造“已人工录制”，也不得在未获授权时自动操作真实账号或支付页面。

1. 从 `apps` 选择准确包名后运行 `record-start`，保存 `sessionId`。
2. 只有 `record-status --session-id <id>` 返回设备声明的活动录制状态，才能提示用户开始手工操作。
3. 等用户明确完成操作后，用同一 `sessionId` 执行 `record-stop`。
4. 只有停止成功终态且返回新用例标识，才运行 `cases`/`case-get` 核验录制结果。
5. 超时、中断或用户放弃时也要查询并停止同一会话；不得停止手工界面或其他智能体创建的录制。

## 历史记录

回放和性能历史分别使用 `replay-history-*` 与 `perf-history-*`。先用 `*-history-list --limit <1..500>` 获取不透明 `id`，再用同一 `id` 查询详情或删除。不得根据时间、名称或列表位置猜测标识。回放详情只提供有界元数据、JSON 内容和日志预览；当前 CLI 不能导出 App 历史页的完整目录，不得用 `run --artifacts` 冒充完整历史导出。

`replay-history-delete` 和 `perf-history-delete` 是不可逆变更。删除前使用对应 `get` 保存需要的详情，获得用户对准确 `id` 的删除意图，并以精确删除回执为准。

## 独立录屏

`screen-record-start` 会创建独立 `sessionId`，但必须由用户在设备上确认 Android MediaProjection 系统弹窗。在 `screen-record-status` 返回 `pending-user-confirmation` 时，明确提示用户确认；不得点击弹窗、伪造授权或报告已开始。只有进入 `recording` 才表示真实编码已开始。

停止时使用原 `sessionId`。需要本地证据时使用 `screen-record-stop --output <新路径>`；CLI 只允许从设备声明的 `capturesRoot` 下拉取同会话的非空 MP4。在 `pending-user-confirmation` 或尚未编码的 `starting` 阶段放弃时，用原 ID 停止会返回 `cancelledBeforeStart=true`，不产生 MP4，迟到的权限或准备回调不会再启动；当前协议不能安全代替用户关闭已显示的系统弹窗。

录屏正常停止后，可把返回的设备端 `outputPath` 交给 `video-analysis-start --video-path`，并显式提供动作相对录屏起点的 `--action-offset-ms` 与 `--difference-threshold`。只分析 SoloPi `ScreenCaptures` 的直属非空 MP4；保存 `requestId`，等待 `completed` 后读取 `visualResponseTimeMs`。插件缺失、路径无效、并发冲突或 `failed` 都不是有效耗时。

## 相机扫码

`scan-start` 创建独立 `sessionId` 并打开相机页面。相机权限和取景动作必须由用户在手机上完成；`pending-camera-permission` 表示等待用户授权，`scanning` 表示相机已就绪但仍需用户对准二维码或条码。启动命令只等待页面进入可观察状态，后续用原 ID 执行 `scan-status`。

只有 `completed` 才包含 `content`、`format` 和 `codeType`。CLI 扫描分支固定返回 `contentExecuted=false`：即使内容是 HTTP、HTTPS 或 `solopi://`，也只作为数据返回，不打开网页、不执行 Scheme。取消时只能使用启动返回的准确 `sessionId`；手工扫码页面与 CLI 会话互斥，不能接管或关闭其他所有者的相机页面。超时或中断后用原 ID 查询并执行 `scan-cancel`，相机权限不得由 CLI 静默授予。

## 插件管理

`plugin-list` 返回已安装插件和稳定 `pluginId`。`plugin-install --file <本地.zip>` 只接受用户明确提供的本地文件；CLI 自动计算 SHA-256，使用受控随机名称暂存到设备，并在成功、失败和中断路径清理暂存文件。新安装的 App 默认远程插件源为空；不得为用户自动下载不明插件，也不得绕过哈希校验。

安装或 `plugin-remove --id <pluginId>` 只有达到 `completed_restart_required` 才算变更完成，但新状态尚未生效；必须明确告知用户需重启 SoloPi。插件包含动态代码，执行变更前核对文件来源、准确哈希、目标设备和影响范围；不得把“需重启”报告为“已加载”。

## 性能与压力测试

性能测试必须读取 [性能测试](references/performance-testing.md)。指标随设备变化，先运行 `perf-list`。需要现场观察时使用 `perf-display-start/status/stop`，状态会返回租约绑定的当前 `values`；需要 CSV 时使用 `perf-start/status/stop`。两类会话共享性能服务、不能并发，均按准确 `sessionId` 清理；`stopped` 只代表会话停止或数据保存完成，不代表达标。

启动耗时使用安卓 Activity Manager 口径，先从 `apps` 或用户提供的信息核对准确包名，再执行：

```bash
scripts/solopi-ai --pretty startup-time \
  --target-package "com.example.pay" \
  --mode cold \
  --iterations 5 \
  --interval 1
```

命令自动解析 Launcher Activity，逐轮严格读取 `LaunchState`、`Activity`、`TotalTime`、`WaitTime`，并读取系统可选的 `ThisTime`。Android 16 等系统不提供 `ThisTime` 时输出 `null` 和不可用统计，不会伪造数据。任一轮必需字段无效时整次命令失败，不用部分轮次生成汇总。该结果是 Activity Manager 报告的启动耗时；需要界面视觉完成时间时使用独立录屏后的 `video-analysis-*`，两种口径不得混用。

压力测试同样使用独立 `sessionId`。只选择 CLI 暴露的 CPU 或内存参数边界，不得通过 Shell 自行制造负载。执行压力前建立清理责任：

```bash
scripts/solopi-ai --pretty stress-start --cpu-count 1 --cpu-percent 50 --duration 60
scripts/solopi-ai --pretty stress-status --session-id '<session-id>'
scripts/solopi-ai --pretty stress-stop --session-id '<session-id>'
```

无论业务回放通过、失败、超时还是被中断，都在清理阶段停止同一压力会话并确认终态。若不能确认停止，明确报告设备仍可能处于受压状态，不得开始下一轮测试。

## 成功与证据

回放完成必须同时满足：CLI 退出码为 `0`、状态为 `passed`、`results` 非空；请求 `--artifacts` 时还要确认 `result.json`、`screen.png`、`logcat.txt` 存在。失败时保留并报告 `exceptionMessage`、`exceptionStep` 和 `exceptionStepId`。

配置、导入、删除、视频分析、录制、扫码、插件和压力等变更命令必须核对返回的 `requestId` 或 `sessionId`；有会话的命令必须核对准确 `sessionId`，历史和插件分别核对不透明 `id` 与稳定 `pluginId`。插件终态 `completed_restart_required` 只证明变更落盘，不证明新代码已加载。不得把“最新状态”冒充目标请求或目标会话的证据。

## 参考资料

- [能力矩阵](references/capability-matrix.md)：按十个能力域区分直接 CLI、用例间接、用户交互和暂不可安全自动化。
- [App 功能覆盖清单](references/app-feature-inventory.md)：逐项映射 Manifest 页面、25 个设置、用例动作、会话与安全边界。
- [CLI 参考](references/cli-reference.md)：命令、参数、默认值、副作用和固定流程。
- [动作目录](references/action-catalog.md)：66 个安卓枚举、4 个用例管理动作、7 个不可普通回放的控制动作、3 个仅查看动作和 6 个内置动态 Provider 动作。
- [用例编写](references/case-authoring.md)：真实选择器、用例结构、动态动作和导入闭环。
- [性能测试](references/performance-testing.md)：性能采集、安卓启动耗时、视频差分响应耗时、压力会话、数据与自动清理。
- [协议](references/protocol.md)：查询/变更传输边界、状态机、标识所有权和退出码。
- [故障处理](references/troubleshooting.md)：设备、权限、录制、性能、压力、超时与恢复。
- [托管执行与设备池](references/managed-execution.md)：设备矩阵、持久队列、generation 租约、CI/API、恢复与证据治理。
- [端侧 Agent 模型部署](references/model-deployment.md)：运行时选型、签名包、原子安装/回退、provider 路由、基准和发布门禁。

## 安全约束

- 只操作用户明确纳入范围的设备、应用、用例和配置；不得静默授予权限、开启辅助功能或修改设备安全设置。
- 不提供或绕过到任意 Shell、任意 Scheme、任意 HTTP；已有用例中的高风险动作也必须先核对内容与授权。
- 配置只允许 `config-list` 公布的键和值类型。敏感配置、性能/录屏上传地址、远程插件源和内部 ADB 地址只能在 App 界面处理；未知项和越界值必须拒绝。17 个普通可写项修改前保存旧值，必要时经 `config-set` 精确恢复。
- 同类活动会话只允许一个所有者。停止操作必须携带启动返回的准确标识，不得清理未知所有者的录制、性能或压力会话。
- 业务失败和调用方中断不能跳过清理。压力负载必须优先停止；性能与录屏也要确认终态。
- 插件是动态代码。只安装用户明确指定的本地包，核对 SHA-256 和准确 `pluginId`，安装或移除后报告必须重启的风险。
- 不得编造节点选择器。以 `case-get` 或 `inspect` 的真实输出为依据，并保留包名边界。
- 用例导入、删除、配置变更、截图、日志、录屏和性能文件都可能包含敏感信息；使用新的受控路径，不得自动上传或外发。
