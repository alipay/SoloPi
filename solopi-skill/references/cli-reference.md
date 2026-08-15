# SoloPi 命令行参考

本文对应 Skill 自带的唯一入口 `scripts/solopi-ai`。命令是否能在选定设备使用，以本机 `--help`、设备 `capabilities` 和真机结果为准；命令出现在本文不等于所有旧版本设备均支持。

## 前置条件与调用格式

- 使用 Python 3.9 或更高版本。
- 从 `SKILL.md` 所在目录解析绝对入口，保持调用者当前工作目录不变。
- 设备命令需要 `adb` 和至少一台状态为 `device` 的安卓设备；多设备时必须指定 `--serial`。
- `actions`、`case-template`、`case-validate`、`case-step-*`、`perf-analyze`、`model-verify` 和 `model-release-check` 是纯本地命令。
- `startup-time`、`screenshot`、`logs` 只要求 ADB 设备；`startup-time` 还要求目标包存在可解析的 Launcher Activity。其他设备命令要求兼容的 SoloPi。
- CLI 会为查询建立临时 ADB 端口转发并在结束时移除。
- 所有设备变更通过显式 `AdbSchemeActivity` 发送；该组件要求系统 `android.permission.DUMP`，只有 ADB shell 可进入，普通深链不能代替。

```bash
scripts/solopi-ai [全局选项] <命令> [命令选项]
```

全局选项必须放在命令之前：

| 全局选项 | 默认值 | 说明 |
|---|---|---|
| `--adb <path>` | 环境变量 `ADB`，否则为 `adb` | ADB 可执行文件。 |
| `--serial <serial>` | 自动选择唯一在线设备 | 多设备在线时必填。 |
| `--package <package>` | `com.alipay.hulu` | SoloPi 包名，不是被测应用包名。 |
| `--device-port <port>` | `23342` | 设备端只读控制服务端口。 |
| `--local-port <port>` | `0` | 本机转发端口；`0` 表示自动分配。 |
| `--request-timeout <秒>` | `5` | 单次查询超时。 |
| `--startup-timeout <秒>` | `15` | 等待控制服务就绪超时。 |
| `--pretty` | 关闭 | 缩进输出 JSON。 |

## 命令清单

本版 CLI 公开 100 个顶层命令，分组如下。该数字只表示命令入口数量，不代表已经用真机证明所有应用功能和所有动作均可执行。

### 设备、本地与发现（10）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `doctor` | 无 | 检查设备、安装、内部 ADB、悬浮窗、电池优化白名单、辅助功能和自动回放启动；稳定返回 `missingPermissions` 与 `failedChecks`，未就绪退出码为 `2`。 |
| `adb-connect` | `--connect-timeout 20`；`--ready-timeout 5`；`--poll-interval 0.25` | 仅当 `doctor` 唯一缺失内部 `adb` 时，经受保护入口发起 SoloPi 自身连接，按新 `requestId` 等待终态并重新核对完整 `doctor`。 |
| `capabilities` | 无 | 查询设备协议、只读端点和变更能力。 |
| `apps` | 无 | 列出 SoloPi 当前可选择的应用、包名、版本和系统应用标记。 |
| `app-info` | 无 | 查询 SoloPi 版本、设备、协议与许可证信息。 |
| `actions` | 无 | 输出动作编写契约；不访问设备，也不证明插件和权限已就绪。 |
| `app-status` | 无 | 查询 SoloPi 的一般运行状态，与回放专用 `status` 区分。 |
| `inspect` | 无 | 查询当前辅助功能页面树。 |
| `screenshot` | `--output` 必填 | 通过受限 ADB 保存 PNG，会覆盖同名文件。 |
| `logs` | `--output` 必填 | 保存当前 `logcat`，会覆盖同名文件。 |

`adb-connect` 不运行 `adb tcpip 5555`，不修改 `KEY_ADB_SERVER`，也不能代替用户确认设备上的 RSA 授权弹窗。只有连接终态为 `connected`、随后 `doctor.health.ready=true` 且退出码为 `0` 才表示门禁通过。`state=connecting` 只表示后台连接仍在进行；`state=failed` 时保留 `errorCode`、`userActionRequired` 和中文 `requiredUserAction`，不得盲目重复调用。

### 配置（3）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `config-list` | 无 | 查询允许列表、类型、默认值、可写性和数值边界。 |
| `config-get` | `--key` 必填 | 读取一个准确键的当前值和约束；敏感项只返回脱敏标记。 |
| `config-set` | `--key`、`--value` 必填；`--ack-timeout 15`；`--poll-interval 0.2` | 经受保护 ADB Activity 修改可写项，再通过只读查询确认实际值。 |

当前允许列表包含 17 个 CLI 可写项和 8 个仅 App 可处理项。性能数据上传地址、录屏上传地址、远程插件源、内部 ADB 地址、全局参数、加密密钥、数据根目录和控制端口均为 `writable=false`；其中敏感值不通过 HTTP 返回原文。未知键、类型错误和越界值也必须拒绝。普通可写项修改前保存旧值；不要通过原始 Scheme 绕过限制。

### 用例（13）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `cases` | 无 | 列出已录制用例。 |
| `case-get` | `--case` 必填；`--output` 可选 | 查询完整用例并展开步骤；可导出可编辑 JSON。 |
| `case-template` | `--name`、`--target-package` 必填；`--target-label`、`--output` 可选 | 纯本地创建模板。 |
| `case-validate` | `--file` 必填；`--output` 可选；`--running-params-file` 与 `--clear-running-params` 互斥；高风险动作需 `--confirm-high-risk` | 纯本地校验并规范化 JSON；整用例拒绝 Shell、两个内部动作和 Provider 上传 URL，可类型化写入或清除单个用例的 `SEPARATE/UNION` 多参数设置。 |
| `case-step-list` | `--file` 必填；`--index` 可选 | 完整校验后查看全部步骤或准确索引，明确动作、节点要求和高风险标记。 |
| `case-step-add`、`case-step-update` | `--file`、`--step-file`、`--output` 必填；添加可用 `--at`，更新需 `--index` | 添加或完整替换步骤，复用动作、参数、节点和 Provider 校验。 |
| `case-step-delete` | `--file`、`--index`、`--output` 必填 | 删除步骤；拒绝空用例和破坏 Provider 配对的结果。 |
| `case-step-move` | `--file`、`--from-index`、`--to-index`、`--output` 必填 | 移动步骤并重新编号、完整校验。 |
| `case-step-copy` | `--file`、`--index`、`--to-index`、`--output` 必填 | 复制步骤并生成唯一 `stepId`，再完整校验。 |
| `case-import` | `--file` 必填；高风险动作需 `--confirm-high-risk`；`--replace` 默认关闭；`--import-timeout 15`；`--poll-interval 0.2` | 再次执行整用例安全校验，拒绝 Shell、两个内部动作和 Provider 上传 URL，再推送文件并按新 `requestId` 获取导入回执。 |
| `case-delete` | `--case` 必填；`--delete-timeout 15`；`--poll-interval 0.2` | 删除准确用例并按新 `requestId` 获取回执；不可逆。 |
| `result` | `--run-id` 可选 | 只接受终态；指定 ID 时拒绝不匹配的最新运行。只有 `passed` 成功。 |

删除前先用 `case-get --output` 备份。导入时只有明确替换同名用例才能使用 `--replace`。

步骤变更始终要求不同于源文件的输出路径，默认拒绝已有输出；只有明确使用 `--overwrite` 才能覆盖其他输出文件。新增、更新、移动或复制 `CLEAR_DATA`、`KILL_PROCESS`、`JUMP_TO_PAGE` 时必须使用 `--confirm-high-risk`；整用例校验、导入和回放也分别要求同一确认。历史 `EXECUTE_SHELL` 和内部 `HANDLE_PERMISSION_ALERT`、`HIDE_INPUT_METHOD` 只允许查看，禁止新增、更新、移动、复制、校验、导入或回放。

`--running-params-file` 接受只包含 `mode` 和 `paramList` 的 JSON 对象。`SEPARATE` 的每项只能有一个不重复键，值为英文逗号分隔且不含空项的字符串；`UNION` 的每项是一组完整参数，所有项的键集合必须一致。参数键不能有首尾空格。结果中的 `runningParams` 明确返回是否已配置、模式和条目数。该能力对应 App 的 `GEN_MULTI_PARAM`；`run-batch` 仍只负责顺序运行多个用例名，不能替代多参数设置。

### 回放编排（5）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `run` | `--case` 必填；默认等待；高风险动作需 `--confirm-high-risk`；`--target-package`、`--restart-app/--no-restart-app`、`--artifacts`、`--no-auto-start` 可选 | 回放前读取实际步骤并拒绝三类仅查看动作、Provider 上传 URL 和未加载插件，再携带 `requestId + caseId + caseFingerprint` 启动并等待终态。 |
| `run-repeat` | `--case`、`--times` 必填；支持与 `run` 相同的安全确认、目标、重启、超时和证据选项；`--continue-on-failure` 可选 | 每轮重新执行安全预检，再顺序执行同一用例并保留独立 `runId`。 |
| `run-batch` | 重复 `--case` 指定多个用例；其余选项同 `run-repeat` | 每个用例分别安全预检并按输入顺序执行，保留独立结果。 |
| `status` | 无 | 查询当前或最近一次回放状态。 |
| `cancel` | `--run-id` 必填；`--cancel-timeout 30`；`--poll-interval 0.5` | 只有当前活动回放与原始 `runId` 完全一致时才取消并等待 `cancelled`；不得取消其他调用方的运行。 |

每次 `run` 都生成新的 `requestId`，只有状态中的请求 ID 完全一致时才认领其 `runId`；其他客户端抢先启动的同名用例必须报告冲突。`caseFingerprint` 覆盖外部步骤文件实际加载、解密并内联后的完整步骤，App 验证后直接回放该内联快照，不会再次读取步骤路径。`run --no-wait` 的退出码 `0` 只表示已受理且活动。`run-repeat`、`run-batch` 默认遇到失败停止；只有显式继续选项才执行剩余项。批次成功要求所有请求的子运行均通过，不能用汇总掩盖单项失败。

图片对比、截图节点定位和用例内录屏要求 `hulu_imageCompare` 或 `hulu_screenRecord` 已通过本地插件安装流程加载。缺失或仅安装未加载时回放停止并提示重启，不调用 App 的远程插件下载路径。

`--target-package` 必须是设备上已安装且具有 Launcher 的应用，不能是 SoloPi 自身。`--restart-app` 和 `--no-restart-app` 互斥；省略时沿用设备全局策略。所有覆盖都写入运行副本，不修改 GreenDAO 缓存实体、原用例或全局设置。

### 回放历史（3）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `replay-history-list` | `--limit 100`，范围 `1..500` | 按设备稳定顺序返回有界历史摘要和不透明 `id`。 |
| `replay-history-get` | `--id` 必填 | 按准确 `id` 查询一条回放历史详情。 |
| `replay-history-delete` | `--id` 必填；`--delete-timeout 30`；`--poll-interval 0.2` | 按不透明 `id` 删除一条历史并等待精确回执；不可逆。 |

不得用时间、用例名、列表序号或“最新一条”代替 `id`。删除前先用 `replay-history-get` 保存需要的详情，并获得用户对该准确 `id` 的删除意图。

`replay-history-get` 只返回有界元数据、JSON 内容和日志预览。当前 CLI 不能按历史 `id` 导出 App 历史页保存的完整目录、全部截图和完整日志；`run --artifacts` 只采集当次回放证据，不能冒充历史目录导出。

### 插件管理（3）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `plugin-list` | 无 | 列出已安装插件、稳定 `pluginId`、版本、加载状态、依赖和可移除性。 |
| `plugin-install` | `--file` 必填；`--install-timeout 120`；`--poll-interval 0.5` | 校验本地 ZIP，自动计算 SHA-256，使用受控随机名称暂存到设备后安装，并在所有终止路径清理该暂存文件。 |
| `plugin-remove` | `--id` 必填；`--remove-timeout 30`；`--poll-interval 0.5` | 使用 `plugin-list` 返回的稳定 `pluginId` 移除准确非内置插件；保护内置插件和被依赖插件。 |

插件包含可在 SoloPi 进程中运行的动态代码。安装前必须核对用户指定的本地文件、目标设备、来源和 CLI 返回的 SHA-256；不接受 URL，不自动下载或跳过哈希校验。

安装和移除只有精确变更回执达到 `completed_restart_required` 且退出码为 `0` 才算落盘成功。该终态明确表示必须重启 SoloPi 才能完整生效；不得报告为“已加载”或“已无重启移除”。

### 交互录制（3）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `record-start` | `--name`、`--target-package` 必填；`--description` 可选；`--ack-timeout 30`；`--poll-interval 0.5` | 创建新 `sessionId`，等待设备进入 `recording`。 |
| `record-status` | `--session-id` 可选 | 查询当前或最近录制；指定 ID 时拒绝不匹配会话。 |
| `record-stop` | `--session-id` 必填；`--stop-timeout 60`；`--poll-interval 0.5` | 停止准确会话并等待 `stopped`。 |

录制开始后必须由用户在手机上真实触控。CLI 只管理会话，不会替用户决定业务动作，也不能仅凭 `recording` 声称已经录好用例。停止后用 `cases` 和 `case-get` 核验。

### 独立录屏（3）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `screen-record-start` | `--resolution 720x480`；`--bitrate-kbps 2500`；`--frame-rate 30`；`--duration 300` | 创建新 `sessionId`，请求 Android MediaProjection 授权，等待用户确认后的真实编码状态。 |
| `screen-record-status` | `--session-id` 可选 | 查询当前或最近独立录屏；指定 ID 时拒绝不匹配会话。 |
| `screen-record-stop` | `--session-id` 必填；`--output` 可选 | 停止同一会话；成功结束后可从受控 `capturesRoot` 拉取非空 MP4。 |

`--resolution` 使用偶数 `宽x高`，宽高各为 `128..4096`；`--bitrate-kbps` 为 `100..50000`，`--frame-rate` 为 `1..120`，`--duration` 为 `1..3600` 秒。以当前命令 `--help` 为准，不得用 Shell 或原始 Scheme 绕过边界。

启动后状态会先进入 `pending-user-confirmation`，必须明确提示用户在设备上确认系统弹窗。CLI 不会点击、绕过或伪造授权；只有 `state=recording` 才表示录屏真正开始。在 `pending-user-confirmation` 或尚未开始编码的 `starting` 阶段，可用原 `sessionId` 取消；终态会返回 `cancelledBeforeStart=true`，迟到的权限或准备回调不会再启动编码。

`screen-record-stop --output` 必须使用新的本地文件路径。CLI 校验 `outputPath` 的规范路径位于设备声明的 `capturesRoot` 下，且只在文件非空时返回成功。授权前取消不会产生 MP4，不得伪造本地产物。

### 相机扫码（3）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `scan-start` | `--ack-timeout 30`；`--poll-interval 0.5` | 创建 `sessionId` 并打开相机页面，等待进入待授权、扫描中或终态。 |
| `scan-status` | `--session-id` 可选 | 查询当前或最近扫码状态；指定 ID 时拒绝不匹配会话。完成时返回内容和码制。 |
| `scan-cancel` | `--session-id` 必填；`--cancel-timeout 15`；`--poll-interval 0.5` | 只取消准确会话并等待 `cancelled`；不能关闭手工扫码或其他所有者会话。 |

用户必须在设备上确认相机权限并把镜头对准支持的二维码或条码。`pending-camera-permission` 和 `scanning` 都是活动状态，不是扫描成功；只有 `completed` 才包含 `content`、`format` 和 `codeType`。所有 CLI 扫码结果固定 `contentExecuted=false`，HTTP、HTTPS 和 `solopi://` 内容不会被打开或执行。手工扫码页面与协议会话互斥。

### 视频差分分析（2）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `video-analysis-start` | `--video-path`、`--action-offset-ms`、`--difference-threshold` 必填；默认等待；`--analysis-timeout 120` | 分析 SoloPi `ScreenCaptures` 直属非空 MP4，按新 `requestId` 等待视觉响应耗时终态；设备端任务最长运行 5 分钟。 |
| `video-analysis-status` | `--request-id` 必填 | 查询准确视频分析请求；不接受“最新一次”替代。 |

`--video-path` 是 `screen-record-stop` 返回的设备端 `outputPath`，不是 `--output` 拉取后的本地路径。动作偏移范围为 `0..3600000` 毫秒；差异阈值必须大于 `0` 且不超过 `1`。命令不会下载分析插件，也不接受任意设备路径。只有 `state=completed`、`visualResponseTimeMs>=0` 且退出码为 `0` 才是有效结果；`analyzing` 只表示活动，`failed`、插件缺失、路径拒绝和并发冲突均失败。

### 性能实时监控、采集、统计与启动耗时（10）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `perf-list` | 无 | 动态查询指标键、权限和提示。 |
| `perf-current` | 无 | 查询当前已运行性能监视器的即时值；没有运行项时返回空集合。 |
| `perf-display-start` | `--target-package` 与 `--global` 二选一；`--items` 必填；`--ack-timeout 30`；`--poll-interval 0.5` | 创建独占 `sessionId`，启动应用级或全局实时监控并等待 `running`。 |
| `perf-display-status` | `--session-id` 可选 | 查询准确实时监控会话，并返回 `sampledAt` 与租约拥有的当前 `values`。 |
| `perf-display-stop` | `--session-id` 必填；`--stop-timeout 60`；`--poll-interval 0.5` | 停止准确实时监控会话并确认资源清理完成。 |
| `perf-analyze` | `--input` 必填 | 纯本地安全读取 UTF-8、带签名 UTF-8 或 GBK CSV，逐列输出描述性统计并明确跳过非数值列。 |
| `startup-time` | `--target-package` 必填；`--mode cold\|warm`；`--iterations 5`；`--interval 1`；`--launch-timeout 30` | 自动解析 Launcher Activity，使用安卓 Activity Manager 口径测量逐轮启动耗时并统计。 |
| `perf-start` | `--target-package` 与 `--global` 二选一；`--items` 必填；`--ack-timeout 30`；`--poll-interval 0.5` | 创建应用级或全局采集 `sessionId` 并等待 `recording`。 |
| `perf-status` | `--session-id` 可选 | 查询准确会话。 |
| `perf-stop` | `--session-id` 必填；`--stop-timeout 60`；`--poll-interval 0.5`；`--output` 可选 | 等待保存，并可拉取准确会话的 CSV 目录。 |

`perf-stop --output` 拒绝已有本地目录；文件编码由设备配置决定。`stopped` 表示数据保存完成，不表示指标达标。

实时监控与性能录制共享同一个指标服务，不能并发，也不能强行接管 App 手工性能面板。应用相关指标使用 `--target-package`；电池、温度等设备级观察可显式使用 `--global`，两者互斥。启动前先用 `perf-list` 选择设备实际返回的键；保存 `perf-display-start` 返回的 `sessionId`，后续状态和停止只能使用该标识。`perf-display-status` 的 `values` 仅来自该租约拥有的显示项，不会把后续同名会话的数据归给旧任务。设备声明 `stopRetryable=true` 时，停止命令在同一 60 秒预算内最多重试三次。

`startup-time` 不创建性能 `sessionId`，也不依赖 SoloPi 控制协议。`cold` 每轮使用 `am start -W -S` 强制停止目标应用；`warm` 每轮使用 `am start -W -R 2`，第一段负责预热，Activity Manager 在重复前结束顶层 Activity，CLI 只统计第二段。最终以每轮实际返回的 `LaunchState` 为准，`UNKNOWN` 不计为启动样本。命令严格要求 `Status=ok`、`LaunchState`、`Activity`、`TotalTime`、`WaitTime` 和 `Complete`；Android 16 等系统省略 `ThisTime` 时保留该字段为 `null`，不会推导或伪造。任一必需字段无效时退出，且不基于部分轮次输出统计。统计单位为毫秒，每个字段分别给出 `available`、`sampleCount`、`min`、`max`、`mean`、`median` 和最近秩口径的 `p90`。

该命令测量 Activity Manager 报告的启动阶段，不是 `video-analysis-*` 或用例内 `startRecordScreen`/`stopRecordScreen` 通过视频差分计算的视觉完成时间。两种口径不能直接混用或以其中一个替代另一个。

### 性能历史（3）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `perf-history-list` | `--limit 100`，范围 `1..500` | 返回有界性能历史摘要和不透明 `id`。 |
| `perf-history-get` | `--id` 必填 | 按准确 `id` 查询一条性能历史详情与受控文件信息。 |
| `perf-history-delete` | `--id` 必填；`--delete-timeout 30`；`--poll-interval 0.2` | 删除准确历史并等待匹配回执；不可逆。 |

历史管理不代表 CLI 会自动评估性能。阈值、统计口径、基线对比和图表仍需明确的外部分析；不得仅凭历史存在就报告达标。删除前先使用 `perf-history-get` 保存需要的详情并核对准确 `id`。

### 压力测试（3）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `stress-start` | `--cpu-count` 与 `--cpu-percent` 成对；`--memory` 可独立使用；`--duration 60`；`--ack-timeout 30`；`--poll-interval 0.5` | 创建 `sessionId`，在安全边界内启动 CPU/内存压力。 |
| `stress-status` | `--session-id` 可选 | 查询当前或最近压力状态；指定 ID 时拒绝不匹配。 |
| `stress-stop` | `--session-id` 必填；`--stop-timeout 30`；`--poll-interval 0.5` | 清零准确会话的 CPU 与内存压力并确认 `stopped`。 |

压力会话到时自动停止，但正常、失败、超时和中断路径仍必须显式查询并清理。详细边界见 [性能与压力测试](performance-testing.md)。

### 动态 Agent（9）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `agent-session-start` | 可选 `--owner-token`；五项预算；`--ack-timeout 15` | 取得共享设备租约，等待首帧 observation，返回 `sessionId`、`ownerToken` 和时间线路径。 |
| `agent-observe` | `--session-id`、`--owner-token` 必填 | 只读刷新 UI 树，生成新的 `observationId` 和帧内 `nodeId`；旧观察立即失效。 |
| `agent-act` | 身份、`--step-id`、`--observation-id`、`--action` 必填；动作专属参数 | 通过 ADB 提交显式 typed action，轮询同 step receipt，成功时返回 settle 后新观察。 |
| `agent-status` | `--session-id`、`--owner-token` 必填 | 查询会话状态、预算计数、当前观察和租约状态。 |
| `agent-timeline` | `--session-id`、`--owner-token` 必填 | 返回 append-only 有序事件和设备端 JSONL 路径。 |
| `agent-pause`、`agent-resume` | 身份；确认超时与轮询间隔 | 暂停或恢复准确会话；暂停不释放租约，暂停期间拒绝 act。 |
| `agent-end` | 身份；确认超时与轮询间隔 | 正常结束准确会话并确认 `ended` 与租约释放。 |
| `agent-cancel` | 身份；确认超时与轮询间隔 | 取消准确会话并确认 `cancelled` 与租约释放。 |

`agent-act --action` 只有 `click`、`longClick`、`input`、`back`、`home`、`scroll`、`wait`。`click/longClick/input` 必须使用当前观察中的 `--node-id`，`input` 还需 `--text`；`scroll` 需 `--direction`，可选当前 node 与 `1..90` 的 `--distance`；`wait` 需 `100..5000` 的 `--duration-ms`。命令没有 Shell、枚举透传、Provider 或任意 Scheme 参数。

### 端侧模型（9）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `model-verify` | package 必填；API/ABI 可成对指定 | 纯本地核对 schema、RSA 签名、摘要和兼容性。 |
| `model-health` | 全局 serial | 查询 companion、ExecuTorch、API/ABI 与 backend。 |
| `model-install` | package 必填 | 主机和 Android 双重验证后原子安装，不自动激活。 |
| `model-status` | model ID 可选 | 查询 installed/active/previous 版本。 |
| `model-activate` | model ID/version 必填 | 真实加载成功后切换活动版本。 |
| `model-rollback` | model ID 必填 | 加载并恢复 previous 版本。 |
| `model-infer` | model ID 与 inputs/inputs-file 必填 | 对活动模型执行一次受限 tensor 推理。 |
| `model-benchmark` | package、model ID、inputs 必填；warmup/iterations/output 可选 | 采集冷启动、首决策、P50/P95、PSS 与可用功耗，并绑定包和设备。 |
| `model-release-check` | package、benchmark、evaluation 必填 | 先校验证据绑定与兼容性，再按签名阈值批准或阻断发布。 |

完整包格式、fallback 与门禁见[端侧 Agent 模型部署](model-deployment.md)。

### 托管执行与设备池（14）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `managed-init`、`managed-health` | `--database` | 初始化 SQLite WAL 控制面或查询设备/任务/活动租约摘要。 |
| `managed-device-register` | 设备 ID、ADB serial、API level 必填；能力、标签、健康可选 | 持久登记已知设备，不执行探测。 |
| `managed-device-probe` | 全局 `--serial`；设备 ID、能力、标签可选 | 运行 ADB 与 `doctor`，按真实就绪度更新设备池。 |
| `managed-device-list` | `--database` | 列出能力、标签、健康、generation、租约和 circuit 状态。 |
| `managed-submit` | plan、matrix、idempotency key 必填；owner token、决策、重试/租约/保留可选 | 静态校验计划后幂等展开 1..64 个 shard；首次返回任务 owner token。 |
| `managed-status`、`managed-events` | 准确 `--task-id`；events 可带 `--after-sequence` | 查询任务状态或只追加进度。 |
| `managed-report` | 准确 task ID；`--output` 可选 | 输出矩阵、attempt、失败归因、证据 digest 和稳定 CI 退出码。 |
| `managed-cancel` | 准确 task ID 与原 owner token | 取消本任务并 fence 活动 assignment；不能取消其他 owner。 |
| `managed-recover` | `--database` | 回收过期租约，按重试预算重新排队或输出 `not_tested`。 |
| `managed-worker-once` | worker ID、artifacts root 必填 | claim 一个 assignment，续租并复用现有 `verify-run`。 |
| `managed-worker-loop` | 同 once；空闲间隔与有界 poll/assignment 可选 | 在单机持续领取任务；多个进程可并发竞争。 |
| `managed-serve` | Bearer token 必填；默认 `127.0.0.1:8765` | 启动 loopback、1 MiB JSON 上限的版本化 HTTP API。 |

所有命令使用同一数据库契约。assignment 身份必须完整匹配 `taskId + shardId +
attemptId + deviceId + leaseId + ownerGeneration`；旧 worker 的 heartbeat、完成或
释放均失败关闭。API 不启动 worker，也不提供 ADB/Shell/Scheme 透传。详细矩阵、
恢复、HTTP 资源和退出码见[托管执行与设备池](managed-execution.md)。

## 固定流程

### 动态 Agent 观察/动作闭环

```bash
scripts/solopi-ai --pretty agent-session-start --max-steps 10
# 从输出保存 sessionId、ownerToken、observation.observationId 和目标 nodeId
scripts/solopi-ai --pretty agent-act \
  --session-id '<session-id>' --owner-token '<owner-token>' \
  --step-id 'step-001' --observation-id '<observation-id>' \
  --action click --node-id '<node-id>'
# 下一步必须使用 receipt.settledObservation.observationId，或重新 observe
scripts/solopi-ai --pretty agent-timeline \
  --session-id '<session-id>' --owner-token '<owner-token>'
scripts/solopi-ai --pretty agent-end \
  --session-id '<session-id>' --owner-token '<owner-token>'
```

不要把上一帧 `nodeId` 与新 observation 混用。收到 `stale_observation` 时先 `agent-observe` 再决策，不自动重放旧动作。正常路径必须 `agent-end`；放弃、超时或异常路径使用准确身份 `agent-cancel`。只有 receipt 为 `succeeded` 且包含 settled observation 才表示该步完成。

九个动态 Agent 命令都会保留调用前的前台 Activity：CLI 为控制服务或 ADB 写入口短暂唤起 SoloPi 后，会恢复被测 App，再发起观察或等待动作回执。首帧 observation 的根节点因此必须属于可操作主窗口，不能是 SoloPi 控制页或状态栏。

### AI 验证工程（4）

| 命令 | 重要选项 | 行为 |
|---|---|---|
| `verify-normalize` | `--file` 必填；`--output` 可选 | 纯本地规范化需求、AC、场景和预算，不补造缺失测试意图。 |
| `verify-compile` | `--file`、`--output` 必填；`--cases-dir` 可选 | 纯本地生成 Goal Tree、Test Intent IR、DAG、路由、固定用例和内容指纹。 |
| `verify-validate` | `--plan` 必填 | 纯本地校验静态契约、动作安全和 `planFingerprint`。 |
| `verify-run` | `--plan`、全新 `--artifacts` 必填；动态计划可选 static/on-device/cloud provider | 复用固定回放和动态 Agent，由 Result Judge 联合 checkpoint oracle、required cleanup 和本次运行证据输出统一报告。 |

`verify-run` 的退出码 `0` 只对应报告 `passed`；`failed` 和 `not_tested` 均为 `2`，但二者含义不同。Agent 决策只有 `act`、`done`、`blocked`，其中 `done` 不具有通过语义。完整输入、路由、三态和报告字段见[验证工程](verification-engine.md)。

端侧 provider 必须带 `--model-package`，且该包 model/version 与可选显式参数一致；
它不能与 `--agent-decisions` 混用。cloud fallback 只处理基础设施错误，不处理
非法决策、产品失败或 checkpoint oracle 规则失败；这些结果仍由 Result Judge 裁决。

```bash
scripts/solopi-ai --pretty verify-compile \
  --file solopi-harness-cli/fixtures/verification/counter-success.json \
  --output artifacts/counter-success.plan.json \
  --cases-dir artifacts/counter-success-cases
scripts/solopi-ai --pretty verify-validate \
  --plan artifacts/counter-success.plan.json
scripts/solopi-ai --pretty verify-run \
  --plan artifacts/counter-success.plan.json \
  --artifacts artifacts/counter-success-run-001
```

### 无人值守矩阵执行

```bash
scripts/solopi-ai --pretty managed-device-probe \
  --database artifacts/managed.sqlite --device-id pixel-8
scripts/solopi-ai --pretty managed-submit \
  --database artifacts/managed.sqlite \
  --plan artifacts/counter-success.plan.json \
  --matrix requirements/android-matrix.json \
  --idempotency-key '<ci-build-id>' --owner-token '<ci-owner-secret>'
scripts/solopi-ai --pretty managed-worker-once \
  --database artifacts/managed.sqlite \
  --worker-id ci-worker-1 --artifacts-root artifacts/managed-runs
scripts/solopi-ai --pretty managed-report \
  --database artifacts/managed.sqlite --task-id '<taskId>'
```

只有 `managed-report` 达到矩阵终态并返回对应稳定退出码才算 CI 完成。首次
`managed-submit` 返回的 task/owner 身份必须由 CI secret store 保存，不能写入
证据或日志。

### 单次同步回放

```bash
scripts/solopi-ai --pretty doctor
# 仅当 doctor 的唯一缺失项为 adb 时执行下一行，然后再次以返回的 doctor 为准
scripts/solopi-ai --pretty adb-connect
scripts/solopi-ai --pretty cases
scripts/solopi-ai --pretty run \
  --case "payment-smoke" \
  --run-timeout 600 \
  --artifacts artifacts/payment-smoke
scripts/solopi-ai --pretty result --run-id '<run-id>'
```

只有终态 `passed`、结果非空且退出码为 `0` 才算通过。

### 多设备

```bash
scripts/solopi-ai --serial '<adb-serial>' --pretty doctor
scripts/solopi-ai --serial '<adb-serial>' --pretty cases
```

每次调用都重复 `--serial`，并放在命令前。

### 交互录制

```bash
scripts/solopi-ai --pretty apps
scripts/solopi-ai --pretty record-start \
  --name "payment-smoke" \
  --target-package "com.example.pay"
scripts/solopi-ai --pretty record-status --session-id '<session-id>'
# 等用户在设备上完成真实触控后再停止
scripts/solopi-ai --pretty record-stop --session-id '<session-id>'
scripts/solopi-ai --pretty cases
```

### 独立录屏

```bash
scripts/solopi-ai --pretty screen-record-start \
  --resolution 720x480 \
  --bitrate-kbps 2500 \
  --frame-rate 30 \
  --duration 300
# 设备返回 pending-user-confirmation 时，等用户确认系统弹窗
scripts/solopi-ai --pretty screen-record-status --session-id '<session-id>'
scripts/solopi-ai --pretty screen-record-stop \
  --session-id '<session-id>' \
  --output artifacts/screen-recording.mp4
```

只有停止终态成功、本地 MP4 非空且退出码为 `0` 才能报告证据已生成。

需要视觉响应耗时时，保存停止结果中的设备端 `outputPath`，再执行：

```bash
scripts/solopi-ai --pretty video-analysis-start \
  --video-path '<device-outputPath>' \
  --action-offset-ms 850 \
  --difference-threshold 0.2
scripts/solopi-ai --pretty video-analysis-status --request-id '<requestId>'
```

### 相机扫码

```bash
scripts/solopi-ai --pretty scan-start
scripts/solopi-ai --pretty scan-status --session-id '<session-id>'
scripts/solopi-ai --pretty scan-cancel --session-id '<session-id>'
```

用户完成扫码后，以同一 ID 的 `state=completed` 和 `contentExecuted=false` 为准。若用户放弃或权限未处理，使用原 ID 取消；不得自动点击权限框，也不得执行返回内容。

### 插件安装

```bash
scripts/solopi-ai --pretty plugin-list
scripts/solopi-ai --pretty plugin-install --file artifacts/approved-plugin.zip
```

记录 CLI 返回的 SHA-256、`requestId` 和插件信息。达到 `completed_restart_required` 后明确告知用户重启 SoloPi；重启前不得把插件功能声称为已完整生效。

### 压力测试清理

先通过 `stress-start --help` 核对本版参数名与边界。启动后保存 `sessionId`；业务命令无论如何结束，都执行：

```bash
scripts/solopi-ai --pretty stress-status --session-id '<session-id>'
scripts/solopi-ai --pretty stress-stop --session-id '<session-id>'
```

未确认 `stopped` 前停止后续测试。
