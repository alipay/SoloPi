# SoloPi AI 环境准备与排障

设备操作失败、`doctor` 未通过或运行超时时，使用本指南。纯本地的 `actions`、`case-template`、`case-validate`、`case-step-*` 和 `perf-analyze` 不连接设备；其他命令先运行 `doctor`，不要绕过就绪检查。

## 目录

- [安全边界](#安全边界)
- [前置条件](#前置条件)
- [先运行 doctor](#先运行-doctor)
- [恢复 SoloPi 内部 ADB](#恢复-solopi-内部-adb)
- [运行与录制状态冲突](#运行与录制状态冲突)
- [配置问题](#配置问题)
- [独立录屏问题](#独立录屏问题)
- [相机扫码问题](#相机扫码问题)
- [视频差分分析问题](#视频差分分析问题)
- [插件管理问题](#插件管理问题)
- [性能采集问题](#性能采集问题)
- [压力测试问题](#压力测试问题)
- [超时](#超时)
- [Ctrl-C 与超时恢复](#ctrl-c-与超时恢复)
- [端口转发清理](#端口转发清理)
- [证据与文件安全](#证据与文件安全)

## 安全边界

- CLI 没有安装或更新 SoloPi 应用本体的命令。应用缺失或版本不支持控制协议时，停止并请用户通过已批准的渠道安装正确构建。`plugin-install` 只管理已安装 SoloPi 内的本地插件包，不等价于应用安装。
- 不得静默授予权限、开启辅助功能、确认 ADB 授权弹窗或修改设备安全设置。
- 不得用任意 Shell、手工 Scheme、Wi-Fi HTTP 或直接请求变更端点绕过类型化 CLI。HTTP 只允许查询，变更必须走受 `android.permission.DUMP` 保护的显式 ADB Activity。
- 插件包含动态代码。只允许安装用户明确指定的本地 ZIP，记录 SHA-256，并在安装或移除后明确报告需重启 SoloPi。
- `adb tcpip 5555` 会扩大设备攻击面。必须先解释风险并获得用户明确批准；未经批准不得执行。
- 把全局参数放在子命令之前，例如：

```bash
scripts/solopi-ai --serial <serial> --pretty doctor
```

## 前置条件

- 使用 Python 3.9 或更高版本。
- 确保 `adb` 在 `PATH` 中；需要自定义路径时使用全局参数 `--adb <path>`。
- 保持一台设备处于 `device` 状态；多设备时明确指定 `--serial <serial>`。
- 安装包含 AI Harness 的 SoloPi 构建，默认包名为 `com.alipay.hulu`。
- 由用户完成悬浮窗、电池优化白名单、辅助功能和可能出现的 SoloPi 内部 ADB RSA 一次性授权；`background` 当前只是提示型状态，CLI 只能发起内部 ADB 连接。

## 先运行 doctor

```bash
scripts/solopi-ai --serial <serial> --pretty doctor
```

仅在退出码为 `0` 且 `health.ready` 为 `true` 时继续设备操作。根据结果处理：

| 现象 | 含义 | 处理 |
|---|---|---|
| `No online Android device found` | 没有在线设备，退出码 `3` | 连接 USB 或启动模拟器，在设备上人工确认主机 ADB 授权，再检查 `adb devices -l`。 |
| `Multiple devices are online` | 在线设备超过一台，退出码 `3` | 选择目标设备，使用全局参数 `--serial <serial>` 重试。 |
| `Requested device is not online` | 指定序列号的 `get-state` 不是 `device`，退出码 `3` | 核对序列号、连接和授权；不要自动改选其他设备。 |
| `installed: false` | SoloPi 未安装，退出码 `2` | 停止。CLI 不能安装或更新应用，请用户安装正确构建后重跑 `doctor`。 |
| `SoloPi control server did not become ready` | 应用已启动，但控制服务在启动超时内不可达，退出码 `4` | 检查应用版本、进程或崩溃日志；确认设备连接后重试。不要改用设备网络直连 HTTP 端口。 |
| `Unable to reach SoloPi control server` | ADB 转发后的 HTTP 请求失败，退出码 `4` | 检查 ADB 状态和 SoloPi 进程；保留错误中的 `url`，重跑 `doctor`。 |
| `invalid JSON` 或 `non-object response` | 应用返回内容不符合协议，退出码 `4` | 记录响应摘要，检查 CLI 与应用版本是否匹配；不要猜测或继续执行变更命令。 |
| `health.ready: false`、`missingPermissions` 或 `failedChecks` 非空 | 一次性权限或就绪检查未完成，退出码 `2` | `missingPermissions` 精确列出缺失的 `adb`、`float`、`powerSave`、`background` 或 `accessibility`；`failedChecks` 列出 `appInitialized`、`permissions`、`autoStart` 或不一致的 `ready`。`powerSave=false` 表示 SoloPi 尚未加入电池优化白名单。仅当唯一缺失项为 `adb` 时运行 `adb-connect`；其他项由用户在设备上处理。 |

## 恢复 SoloPi 内部 ADB

SoloPi 默认从设备内连接 `localhost:5555`。USB ADB 已授权并不代表该端口已监听；端口未开启时通常表现为 `ECONNREFUSED` 或 ADB 权限失败。

1. 先只读确认 USB ADB：

```bash
adb -s <serial> get-state
```

2. 确认 `doctor` 的 `missingPermissions` 只有 `adb`，然后运行类型化恢复命令：

```bash
scripts/solopi-ai --serial <serial> --pretty adb-connect
```

3. 若设备显示 SoloPi ADB 密钥授权弹窗，由用户亲自确认，再使用同一命令重试。CLI 不自动点击，也不把 `connecting`、请求已受理或 Activity 已启动当作连接成功。
4. 只有命令返回 `connected=true`、完整 `doctor.health.ready=true` 且退出码为 `0` 才继续设备功能。
5. 若返回 `adb_connection_failed`，内部端口可能未监听，也可能尚未确认 RSA；布尔连接结果无法区分两者。保留结构化错误，不要盲目修改设置。
6. 只有用户明确要求开启 TCP ADB，并在获知攻击面扩大的风险后明确批准，才可执行：

```bash
adb -s <serial> tcpip 5555
```

7. 等待 adbd 重启，再运行 `adb-connect`。不得用自动点击代替用户授权，也不得把该步骤当作普通运行时权限授予。

## 运行与录制状态冲突

| 现象 | 处理 |
|---|---|
| `A replay is already running` | 先运行 `status`。等待原运行结束；只有用户授权且活动 `runId` 与本任务保存值一致时才执行 `cancel --run-id`。不要并发启动第二个用例。 |
| `Harness run was replaced by another replay` | 当前等待的 `runId` 已被替换。停止归因，保存 `expectedRunId`，用 `status` 确认当前运行。 |
| `Another replay acquired the device before this request` | 另一个客户端在启动竞态中取得了回放所有权，即使用例名相同也不能认领。保留本次 `requestId` 和返回的 `activeRun`，等待原所有者处理。 |
| 启动状态的 `requestId` 不匹配 | 不得把该 `runId` 当成本任务结果，也不得据此执行取消；只认领本次 `run` 生成的准确请求 ID。 |
| `result --run-id` 不匹配 | 不得把 `latestRun` 当作目标运行结果。使用保存的准确 `runId`，排查是否有其他调用方启动了新回放。 |
| `result` 报告非终态 | 继续用 `status` 等待；需要终止时按授权和原始准确标识执行 `cancel --run-id`。 |
| `A recording session is already active` | 运行 `record-status`。只有保存的 `sessionId` 与状态完全匹配且会话属于本任务时才能停止；否则等待原所有者处理。 |
| 录制一直处于 `starting` | 设备可能仍显示权限或准备界面。报告缺口并由用户处理；不要盲目再启动。确认放弃后，用原 `sessionId` 查询和停止。 |
| `record-status` 标识不匹配 | 停止归因，不得停止最新的其他会话。保留期望标识和最新状态。 |
| 录制已为 `recording` 但没有步骤 | `record-start` 只建立交互会话；必须由用户在手机上真实触控。不得把空会话声称为已完成录制。 |
| `record-stop` 后找不到用例 | 只有 `state=stopped` 仍不足以证明目标内容正确；运行 `cases` 和 `case-get` 核对准确用例名与步骤。 |

## 配置问题

| 现象 | 处理 |
|---|---|
| 未知配置键 | 重跑 `config-list`，使用响应中的准确键；不得用原始 Scheme 猜键。 |
| 值类型或范围错误 | 用 `config-get` 查看 `type`、`min`、`max`、`writable`，按约束重试。 |
| `writable=false` | 该项属于上传地址、远程插件源、内部 ADB 地址、敏感配置、数据迁移、存储目录或控制端口，只能由用户在 SoloPi 界面处理。不得绕过。 |
| 设置确认超时 | 变更可能已送达；用 `config-get` 读取同一键并比较规范化值，不要立即重复设置。 |
| 修改语言、控制端口或应用显示后连接变化 | 这些设置可能重启服务或刷新应用列表。等待服务恢复，重新运行 `doctor`；不要改用 Wi-Fi 端口。 |
| 需要回滚 | 修改前保存的旧值仍在允许列表且可写时，用 `config-set` 精确恢复，再用 `config-get` 确认。 |

## 独立录屏问题

| 现象 | 含义与处理 |
|---|---|
| `state=pending-user-confirmation` | 设备正在等待 Android MediaProjection 系统弹窗。提示用户在设备上确认；不得自动点击或把该状态报告为已开始录屏。 |
| 用户在授权前放弃 | 使用原 `sessionId` 执行 `screen-record-stop`。`pending-user-confirmation` 或尚未开始编码的 `starting` 会进入取消终态并返回 `cancelledBeforeStart=true`；迟到的权限或准备回调不会再启动录屏。该路径没有 MP4。 |
| 系统弹窗在取消请求后仍显示 | Android 没有安全公开接口代替用户关闭已显示的弹窗。会话已阻止迟到回调；请用户手工取消弹窗。 |
| 录屏会话冲突 | 先运行 `screen-record-status`。只有保存的 `sessionId` 完全匹配且属于本任务时才能停止。手工性能录屏占用 MediaProjection 时等待原所有者结束。 |
| `screen-record-status` 标识不匹配 | 保留期望和最新会话信息，停止归因；不得停止其他所有者的最新录屏。 |
| `state=failed` | 报告 `error`。可能原因包括编码器不支持、授权数据失效、服务断开或输出未写入；失败不等于 MP4 可用。 |
| `--output` 拉取失败 | 保留 `capturesRoot`、`outputPath`、`fileSize` 和会话状态。只接受规范路径在 `capturesRoot` 下的非空 MP4；修复 ADB 后重新核验，不得伪造本地文件。 |

## 相机扫码问题

| 现象 | 含义与处理 |
|---|---|
| `state=pending-camera-permission` | 等待用户在设备上确认相机权限。不得用 ADB 或自动点击静默授权；授权后用原 `sessionId` 继续查询。 |
| `state=scanning` | 相机已就绪，仍需用户把二维码或条码放入取景框。该状态不是扫描成功。 |
| 手工扫码或协议会话冲突 | 手工页面和 CLI 会话互斥。等待原所有者结束；只有保存的准确 `sessionId` 属于本任务时才能执行 `scan-cancel`。 |
| `scan-status` 标识不匹配 | 保留期望和最新会话信息，停止归因；不得取消最新的其他会话。 |
| 用户关闭页面 | 同一会话进入 `cancelled`。这不是扫码成功，也没有可用 `content`。 |
| `state=failed` | 报告 `error`。常见原因是权限拒绝、相机初始化失败或页面无法启动；失败内容不得当作扫码结果。 |
| 扫到 HTTP、HTTPS 或 `solopi://` | 只读取 `content`，同时确认 `contentExecuted=false`。不得自行打开链接或执行 Scheme。 |
| 启动超时或 Ctrl-C | CLI 会尝试用本次创建的同一 `sessionId` 有界取消；保留 `cleanup` 证据，再用 `scan-status` 核对。不得启动第二个会话覆盖未知状态。 |

## 视频差分分析问题

| 现象 | 含义与处理 |
|---|---|
| `plugin_missing` | 设备没有已加载的 `hulu_screenRecord` 分析插件。不要自动下载；只在用户提供并批准本地插件包后按插件流程安装、重启并复核。 |
| `unsafe_video_path` 或 `invalid_parameter` | `--video-path` 不是 SoloPi `ScreenCaptures` 直属非空 MP4，或动作偏移/差异阈值越界。使用 `screen-record-stop` 返回的设备端 `outputPath`，不要传本地拉取路径。 |
| `analysis_busy` | 另一分析请求仍活动。保存响应中的 `activeRequestId`，等待原所有者终态；不得并发覆盖。 |
| `analysis_not_found` | 应用重启、回执淘汰或 requestId 错误。停止归因，不得把最新分析结果冒充目标请求。 |
| `state=failed` | 报告同一 `requestId` 的 `error`；失败没有有效 `visualResponseTimeMs`。 |
| 等待超时或中断 | 用原 `requestId` 执行 `video-analysis-status`。分析器没有强制取消入口，但设备会在任务运行满 5 分钟时写入失败终态并释放占用；确认终态前不要启动下一次分析。 |

## 插件管理问题

| 现象 | 含义与处理 |
|---|---|
| 本地文件不是可接受 ZIP、过大或 SHA-256 不匹配 | 停止安装，核对用户指定的原文件与来源。不得改用 URL、重新打包或跳过哈希校验。 |
| `mutation_busy` 或 `plugin_in_use` | 其他插件变更或 SoloPi 会话仍活动。等待原所有者完成，不得并发安装/移除或强制停止未知会话。 |
| `core_plugin_protected` | 目标是内置核心插件，不允许移除。不得用文件操作绕过保护。 |
| `plugin_has_dependents` | 其他已安装插件依赖目标。报告回执中的依赖项，不自动级联删除。 |
| `completed_restart_required` | 变更已落盘，但当前 SoloPi 进程中的动态代码状态不是最终证据。明确提示用户重启；重启后再用 `plugin-list` 和相关功能验证。 |
| 安装失败、超时或中断 | CLI 应尝试清理本次受控随机暂存文件。保留 `requestId`、SHA-256 和结构化错误；不得手工扩大删除到导入根目录或其他文件。 |

## 性能采集问题

| 现象 | 含义与处理 |
|---|---|
| `Unsupported performance item(s)` | 当前设备不支持所请求的键。重新运行 `perf-list`，只使用本次返回的 `items[].key`。 |
| `Performance permissions are not ready` | 所选指标依赖的权限、SoloPi 内部 ADB 或省电配置不满足。报告完整 `error`，由用户完成设备配置后重试；不得自动授权。 |
| `Target application is not installed` | `--target-package` 不是选定设备上的已安装包。核对设备和被测包名，不要误用 SoloPi 自身包名。 |
| `A performance recording is already active` | 先运行 `perf-status`。只有确认当前采集属于本任务并得到停止授权后，才能用准确 `sessionId` 停止。 |
| `A performance display session is already active` | 先运行 `perf-display-status`。只有准确 `sessionId` 属于本任务时才能停止；否则等待原所有者处理。 |
| `Another performance display session is already running` | 手工性能面板或其他调用方占用共享指标服务。等待其结束，不要强行清空显示项。 |
| `Latest performance session does not match --session-id` | 最新会话不是目标会话。保留 `expectedSessionId` 和 `latestPerformance`，不得把最新数据归给原任务。 |
| `Latest performance display session does not match --session-id` | 最新实时监控不是目标会话。保留 `expectedSessionId` 和 `latestPerformanceDisplay`，不得读取或停止其他所有者会话。 |
| `values` 为空或某项为 `null` | 非阻塞查询会先返回最近缓存并触发后台刷新。先确认状态为 `running`、`ownedDisplayNames` 非空，再等待一个采样周期，用同一 `sessionId` 重查。仍无值时保留完整状态和日志；不得从 `runningItems` 猜测当前值。 |
| 实时监控保持 `stopping` | 仅当 `stopRetryable=true` 时，CLI 才会用同一 `sessionId` 在总超时内最多重试三次。重试耗尽后保留会话，不能强行清空显示服务。 |
| `perf-status` 因控制服务不可达而失败 | 若已经保存本任务的准确 `sessionId`，直接执行同一标识的 `perf-stop`。CLI 只在预检得到类型明确的不可达错误时发送恢复停止，并有限等待同一会话终态；不得改用最新会话或猜测标识。 |
| `state=failed` | 查看状态中的 `error`。失败不是安全保存完成，不得报告性能数据已生成。 |
| `Performance output path already exists` | `--output` 为已有路径。改用新的证据目录，不要删除或覆盖旧数据。 |
| ADB 拉取失败 | 设备保存可能已完成。保留 `outputPath` 和会话状态，修复连接后核验设备目录；不要伪造本地产物。 |

## 压力测试问题

| 现象 | 含义与处理 |
|---|---|
| CPU 线程数超出设备范围 | CLI 会读取设备在线处理器数；降低线程数。不得用 Shell 启动额外压力进程。 |
| CPU 线程数与百分比只有一个为零 | 两者必须同时为零或同时大于零。只做内存压力时两者都设为零。 |
| 内存或持续时间越界 | 内存为 `0..2048` MB，持续时间为 `1..3600` 秒；CPU 或内存至少启用一种。 |
| 压力会话冲突 | 运行 `stress-status`。只有准确 `sessionId` 属于本任务时才能停止，不要清理未知负载。 |
| 启动确认超时或中断 | 从结构化错误保存 `sessionId`，立即查询准确状态；活动时运行 `stress-stop`，确认 `stopped`。 |
| 到达持续时间 | 设备端应自动清零压力，但调用方仍要查询同一会话确认终态。未确认时停止后续测试。 |
| `state=failed` | 报告 `error` 并再次核对设备状态；失败本身不能证明 CPU 与内存负载已释放。 |

## 超时

| 超时 | 默认值与退出码 | 处理 |
|---|---|---|
| 控制服务启动 | `--startup-timeout 15`，退出码 `4` | 检查 SoloPi 进程、版本和日志，然后重跑 `doctor`。会话会尝试移除临时端口转发。 |
| HTTP 请求 | `--request-timeout 5`，退出码 `4` | 检查 ADB 与控制服务；不要直接通过 Wi-Fi 调设备 HTTP 端口。 |
| 内部 ADB 连接 | `adb-connect --connect-timeout 20`，退出码 `124` | 保留 `requestId` 与最后状态；确认设备上可能出现的 RSA 授权提示，重跑 `doctor`。不得把超时当作已连接，也不得自动执行 `adb tcpip 5555`。 |
| 运行确认 | `run --ack-timeout 15`，退出码 `124` | 命令可能已送达。先查 `status`，不要立即重复 `run`。 |
| 运行完成 | `run --run-timeout 600`，退出码 `124` | 设备端回放可能仍在继续。保留超时证据，再按恢复流程处理。 |
| 导入回执 | `case-import --import-timeout 15`，退出码 `124` | 导入可能已完成。先用 `cases` 查同名用例，避免盲目重试或误用 `--replace`。 |
| 历史删除 | `*-history-delete --delete-timeout 30`，退出码 `124` | 变更可能已送达。使用准确 `id` 重新查询列表/详情；不得改删最新或相邻记录。 |
| 取消完成 | `cancel --run-id <id> --cancel-timeout 30`，退出码 `124` | 不得假定已取消；持续查询准确 `runId` 的 `status`，确认终态。 |
| 性能启动确认 | `perf-start --ack-timeout 30`，退出码 `124` | 启动可能已送达，错误响应会保留 `sessionId`。查询准确状态：若已为 `recording`，可继续原业务流程；若仍为 `starting`，用同一 ID 执行 `perf-stop` 请求取消。系统权限流程不能被 CLI 静默关闭，需由用户完成后再确认终态。不要立即重复启动。 |
| 性能停止保存 | `perf-stop --stop-timeout 60`，退出码 `124` | 会话可能仍为 `stopping`。继续查询准确 `sessionId`，确认 `stopped` 或 `failed` 后再处理。 |
| 性能实时监控启动/停止 | `perf-display-start --ack-timeout 30`、`perf-display-stop --stop-timeout 60`，退出码 `124` | 保存新 `sessionId`，运行 `perf-display-status`；若仍活动，只用同一 ID 停止。未确认终态前不得启动采集或另一监控。 |
| 交互录制启动/停止 | 以命令 `--help` 的确认超时为准，退出码 `124` | 保存 `sessionId`，运行 `record-status`；不得停止不匹配会话，也不得把超时当作已保存。 |
| 独立录屏启动/停止 | 以 `screen-record-start --help` 和 `screen-record-stop --help` 公布的超时为准，退出码 `124` | 用原 `sessionId` 查询。`pending-user-confirmation` 时等用户确认或用原 ID 取消；`stopping` 时继续等待输出落盘，不重复启动。 |
| 相机扫码启动/取消 | `scan-start --ack-timeout 30`、`scan-cancel --cancel-timeout 15`，退出码 `124` | 保存原 `sessionId` 并查询；等待用户授权/取景或按原 ID 取消。不得关闭手工页面或其他会话。 |
| 插件变更 | 以 `plugin-install/remove --help` 公布的超时为准，退出码 `124` | 保留 `requestId` 与 SHA-256，核对最终插件列表和回执；不盲目重复安装，并确认本次暂存清理结果。 |
| 压力启动/停止 | 以命令 `--help` 的确认超时为准，退出码 `124` | 优先查询并停止原 `sessionId`；压力清理优先于继续回放或性能采集。 |

只在已确认设备或网络较慢时调整超时。延长超时不能修复权限、版本或协议错误。

## Ctrl-C 与超时恢复

Ctrl-C 返回退出码 `130`；运行超时返回 `124`。两者都不会自动取消设备端回放。按顺序恢复：

```bash
scripts/solopi-ai --serial <serial> --pretty status
scripts/solopi-ai --serial <serial> --pretty cancel --run-id '<run-id>'
scripts/solopi-ai --serial <serial> --pretty result --run-id '<run-id>'
```

- 若 `status` 已是终态，不要再 `cancel`，直接获取精确结果。
- `cancelled` 是预期终态，但 `result` 仍返回退出码 `2`，因为只有 `passed` 算成功。
- 未确认原运行终止前，不要重跑同一或其他用例。

性能采集被 Ctrl-C 中断时也不会自动停止。若已获得 `sessionId`，按顺序恢复：

```bash
scripts/solopi-ai --serial <serial> --pretty perf-status \
  --session-id '<session-id>'
scripts/solopi-ai --serial <serial> --pretty perf-stop \
  --session-id '<session-id>' \
  --output artifacts/performance-recovery-001
```

若状态已经是 `stopped`，再次执行相同 `perf-stop` 可拉取尚未拉取的数据；若是 `failed`，报告错误并停止。会话不匹配时不得停止最新的其他会话。

若设备返回 `stopping` 且 `stopRetryable=true`，CLI 会用同一 `sessionId` 自动重试清理，单次最多三次。重试仍失败时保留该会话和错误，不得开始新的性能采集；排查设备服务后再次执行同一 `perf-stop`。

若最初的 `perf-status` 或 `perf-stop` 状态预检返回类型明确的“SoloPi 控制服务不可达”，仍可用本任务保存的准确 `sessionId` 再次执行 `perf-stop`。CLI 会绕过这一次不可用的状态预检，向受保护入口发送准确标识，并在停止总预算内轮询恢复；轮询期间只重试同类暂时不可达。无效 JSON、响应结构错误、会话不匹配或其他协议错误不会进入该恢复路径。只有返回 `recoveredWithoutPreflight=true` 且同一会话为 `stopped` 或 `failed` 时才取得终态；超时或仅成功发出停止请求时仍不得启动新会话。

性能实时监控中断时使用独立命令恢复，不能用 `perf-stop` 代替：

```bash
scripts/solopi-ai --serial <serial> --pretty perf-display-status \
  --session-id '<session-id>'
scripts/solopi-ai --serial <serial> --pretty perf-display-stop \
  --session-id '<session-id>'
```

若 `stopRetryable=true`，`perf-display-stop` 同样只对该租约有限重试；终态不明确时停止后续性能任务。

录制或压力命令被中断时，分别使用准确标识恢复：

```bash
scripts/solopi-ai --serial <serial> --pretty record-status --session-id '<session-id>'
scripts/solopi-ai --serial <serial> --pretty record-stop --session-id '<session-id>'
scripts/solopi-ai --serial <serial> --pretty stress-status --session-id '<session-id>'
scripts/solopi-ai --serial <serial> --pretty stress-stop --session-id '<session-id>'
```

压力会话的自动到时清理是兜底，不是省略显式清理的理由。

独立录屏被中断时，也只操作原会话：

```bash
scripts/solopi-ai --serial <serial> --pretty screen-record-status \
  --session-id '<session-id>'
scripts/solopi-ai --serial <serial> --pretty screen-record-stop \
  --session-id '<session-id>' \
  --output artifacts/screen-recording-recovery.mp4
```

`pending-user-confirmation` 或尚未编码的 `starting` 可安全标记 `cancelledBeforeStart=true`，不产生 MP4。若会话不匹配，不得停止最新的其他会话。

相机扫码中断时只查询和取消原会话：

```bash
scripts/solopi-ai --serial <serial> --pretty scan-status \
  --session-id '<session-id>'
scripts/solopi-ai --serial <serial> --pretty scan-cancel \
  --session-id '<session-id>'
```

若状态已为 `completed`，只读取内容并确认 `contentExecuted=false`；若为 `cancelled` 或 `failed`，不要重复取消。标识不匹配时停止，不能操作最新的其他会话。

## 端口转发清理

CLI 会为设备端口建立临时 localhost ADB 转发，并在正常退出、协议错误和 Ctrl-C 处理中尝试移除。进程被强制终止时可能来不及清理。

```bash
adb -s <serial> forward --list
adb -s <serial> forward --remove tcp:<local-port>
```

只移除已确认属于本次 Harness 会话的映射，不要清理其他工具的转发。优先保留默认 `--local-port 0`，避免固定端口冲突。

## 证据与文件安全

- `run --artifacts <dir>`、`screenshot --output`、`logs --output` 以及各类 `--output` 会创建父目录，并可能覆盖同名文件。使用新的运行目录，或先取得覆盖意图。
- 超时时如指定 `--artifacts`，CLI 会尽力保存 `result.json`、`screen.png` 和 `logcat.txt`；保存证据不代表回放已停止。
- 截图可能包含账户、支付或个人信息；`logs` 保存当前设备 logcat 缓冲区且不会清空日志。按敏感数据处理、限制访问并避免外发。
- 失败、超时和取消证据都要绑定准确 `runId`，不得与较新运行混用。
- 性能数据要绑定准确 `sessionId`。`perf-stop --output` 只接受全新的本地路径；原始 CSV 编码由设备设置决定，默认通常为 `GBK`。
- 独立录屏要绑定准确 `sessionId`。`screen-record-stop --output` 只拉取 `capturesRoot` 下的规范非空 MP4；授权前取消时没有文件。
- 插件 ZIP 是可执行输入。保留用户原文件和 SHA-256；CLI 只清理它为本次安装生成的受控设备暂存，不删除用户原文件或其他导入项。
- 性能文件可能包含包名、进程、网络、设备状态和业务时序。限制访问、避免外发；CLI 不提供自动上传选项。
