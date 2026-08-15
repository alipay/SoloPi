# SoloPi 应用功能覆盖清单

本清单用于证明 App 功能与 Skill CLI 的对应关系。它以源码入口为依据，不以命令数量代替功能覆盖，也不把静态存在、请求受理或活动状态当作真机通过。

## 盘点口径

- 页面入口：`solopi-app/app/src/main/AndroidManifest.xml`、`IndexActivity` 与 `@EntryActivity`。
- 设置入口：`SettingsActivity` 与 `ConfigSchemeResolver` 的类型化允许列表。
- 用例动作：`PerformActionEnum`、`action-catalog.md` 与三个 Android
  `ActionProvider` 实现发布的 6 个动态动作契约；AI 验证的 `DecisionProvider`
  是独立的 Action Proposal 接口，不属于 App 动作清单。
- 设备协议：所有 `@SchemeResolver`、`HarnessSchemeResolver.capabilities()`。
- Skill 入口：只使用 `scripts/solopi-ai`；不得调用仓库根目录 `tools/` 兼容入口。

状态含义：

| 状态 | 证明范围 |
|---|---|
| 直接 CLI | 有类型化命令、输入校验、所有权和结构化回执；仍需目标设备终态验证。 |
| 用例间接 | 通过类型化用例步骤导入并回放；只有真实回放终态和证据能证明执行。 |
| 用户确认 | CLI 管理会话，系统权限、相机取景或业务触控由用户完成。 |
| 只读或人工保留 | 为安全、隐私或数据迁移保留 App UI；CLI 只暴露约束或只读状态。 |

## Manifest 页面与入口

| 页面或组件 | App 功能 | Skill CLI 映射 | 覆盖方式 |
|---|---|---|---|
| `SplashActivity`、`IndexActivity` | 初始化、主页、权限准备、入口发现 | `doctor`、`adb-connect`、`capabilities`、`app-status` | 内置录制/性能入口已有直接 CLI；插件新增的 `@EntryActivity` 当前不能由 CLI 动态枚举，属于部分覆盖。 |
| `NewRecordActivity` | 选择应用、交互录制、用例列表 | `apps`、`record-start/status/stop`、`cases` | 直接 CLI + 用户真实触控。 |
| `CaseEditActivity` | 用例描述与步骤编辑 | `case-get/template/validate`、六个 `case-step-*`、`case-import` | 直接 CLI；真机回放另证。 |
| `CaseParamEditActivity` | `SEPARATE` / `UNION` 多参数设置 | `case-validate --running-params-file`、`--clear-running-params`、`case-import --replace` | 直接 CLI。 |
| `NewReplayListActivity` | 单用例回放入口 | `run`、`status`、`result`、`cancel` | 直接 CLI。 |
| `BatchExecutionActivity` | 批量选择与重复执行 | `run-batch`、`run-repeat` | 直接 CLI，每轮独立 `runId`。 |
| `CaseReplayResultActivity`、`BatchReplayResultActivity` | 单次与批次结果 | `result`、`run --artifacts`、`run-batch` 返回的逐轮结果 | 当前运行的结果、截图和 logcat 可直接取证；App 可导出的完整历史目录仍是部分覆盖。 |
| `LocalReplayResultActivity` | 本地回放历史 | `replay-history-list/get/delete` | 摘要、受限详情和精确删除可直接 CLI；完整截图、完整日志及全部文件导出仍需 App，删除不可逆。 |
| `PerformanceActivity` | 指标选择、实时显示、性能采集、压力入口 | `perf-list/current`、`perf-display-*`、`perf-start/status/stop`、`stress-*` | 直接 CLI。 |
| `PerformanceChartActivity` | 性能曲线与保存入口 | `perf-stop --output`、`perf-analyze` | 原始 CSV 与描述统计直接 CLI；图形展示不冒充统一阈值。 |
| `RecordManageActivity` | 性能记录管理 | `perf-history-list/get/delete` | 直接 CLI；删除不可逆。 |
| `RecorderConfigActivity`、`RecordService`、`SimpleRecordService` | 录屏参数、MediaProjection 与 MP4 | `screen-record-start/status/stop` | 直接 CLI + 用户确认系统弹窗。 |
| `QRScanActivity` | 二维码和条码扫描 | `scan-start/status/cancel` | 直接 CLI + 用户相机权限和取景；内容只读。 |
| `SettingsActivity` | 设置、用例导入、插件导入 | `config-*`、`case-import`、`plugin-list/install/remove` | 类型化 CLI；敏感迁移项保留 UI。 |
| `PatchStatusActivity` | 插件状态与更新结果 | `plugin-list/install/remove` | 直接 CLI；本地 ZIP、哈希和重启边界。 |
| `InfoActivity`、`LicenseActivity` | 版本、设备、帮助链接与完整许可证 | `app-info` | 版本、设备与许可证标识可只读查询；帮助链接和完整 `NOTICE.html` 保留 App 查看。 |
| `PermissionDialogActivity` | ADB、悬浮窗、后台、电池优化、辅助功能和录屏授权 | `doctor`、`adb-connect`、各会话的 `userActionRequired` | `doctor` 核对电池优化白名单；RSA 和其他系统权限由用户确认。`background` 是 App 的提示型权限，没有可靠系统真值。 |
| `FileChooseDialogActivity` | 数据目录与本地文件选择 | CLI 使用显式本地路径；`KEY_BASE_DIR` 保留 App UI | 只读或人工保留。 |
| `SchemeActivity`、`AdbSchemeActivity` | 公开只读深链与受 DUMP 保护的 ADB 变更传输 | CLI 内部固定传输；不作为用户可拼接命令 | 安全基础设施。 |

`BaseActivity`、结果 Fragment、Adapter、`FloatWinService` 和安装广播属于上述业务流程的内部支撑，不是独立用户功能入口。`AdbIME` 是录制和回放文本输入的内部支撑；CLI 不把它包装成独立命令，输入法切换与恢复由对应会话负责。

首页还包含自动版本检查、Crash 日志打包后交给邮件应用、从外部目录导入并删除 ADB key 三类流程。它们分别属于 App 更新、系统应用交接和敏感密钥文件处理，不由 CLI 自动触发；不得归入 `doctor` 的已验证范围。

## 设置覆盖

`config-list` 发布 25 个类型化设置规格，其中 17 个可通过 `config-get/set` 读写：

| 分组 | 设置键 |
|---|---|
| 导出与语言 | `KEY_OUTPUT_CHARSET`、`KEY_USE_LANGUAGE` |
| 回放与录制 | `KEY_ALLOW_REPLAY_DIFFERENT_APP`、`KEY_RESTART_APP_ON_PLAY`、`KEY_REPLAY_AUTO_START`、`KEY_RECORD_COVER_MODE`、`KEY_SKIP_ACCESSIBILITY` |
| 应用与等待 | `KEY_DISPLAY_SYSTEM_APP`、`KEY_MAX_WAIT_TIME`、`KEY_MAX_SCROLL_FIND_COUNT` |
| 文件与截图 | `KEY_AUTO_CLEAR_FILES_DAYS`、`KEY_SCREENSHOT_RESOLUTION` |
| 显示与日志 | `KEY_HIGHLIGHT_REPLAY_NODE`、`KEY_HIDE_LOG`、`KEY_SCREEN_FACTOR_ROTATION`、`KEY_SCREEN_ROTATION` |
| 更新 | `KEY_CHECK_UPDATE` |

以下八项仍出现在 `config-list/get`，但固定 `writable=false`：

| 设置键 | 保留 UI 的原因 |
|---|---|
| `KEY_GLOBAL_SETTINGS` | 可能包含业务敏感全局参数，只返回脱敏状态。 |
| `KEY_AES_KEY` | 修改会迁移已有加密用例数据。 |
| `KEY_BASE_DIR` | 修改只切换进程内数据根目录，重启后的持久生效与历史数据处理必须由 App 界面确认；CLI 不声称自动迁移。 |
| `KEY_CONTROL_PORT` | 热切换会中断当前控制通道；它不是设置页普通控件。 |
| `KEY_PERFORMANCE_UPLOAD` | 会把性能数据外发，只允许用户在 App 中核对地址。 |
| `KEY_RECORD_SCREEN_UPLOAD` | 会把录屏数据外发，只允许用户在 App 中核对地址。 |
| `KEY_PATCH_URL` | 远程源可下载并加载动态代码；CLI 只读，新的默认值为空。 |
| `KEY_ADB_SERVER` | 可改变内部 ADB 连接目标；`adb-connect` 固定不修改该值。 |

未知键、类型不符、越界值和不可写项必须拒绝。不得通过原始 Scheme、HTTP 或 Shell 绕过。

## 用例动作覆盖

- `actions` 公开 66 个安卓枚举动作的编写契约。
- 55 个枚举在步骤结构上可出现；排除仅查看的 `EXECUTE_SHELL`、`HANDLE_PERMISSION_ALERT`、`HIDE_INPUT_METHOD` 后，52 个可编写普通动作通过 `case-template/get/validate`、`case-step-*`、`case-import` 和 `run` 闭环。整用例校验、导入和回放都会再次拒绝这三项、Provider 上传 URL和未确认的高风险动作。
- 4 个用例管理动作通过多参数与步骤编辑命令表达。
- 7 个录制、远控或回放界面控制动作不允许伪装成普通业务步骤，改用类型化生命周期命令。
- `PerformanceActionProvider`、`RecordScreenActionProvider`、`ImageCompareActionProvider` 在当前源码中共发布 6 个内置动态 ActionProvider 动作契约；`actions` 是离线契约清单，不会扫描设备插件。插件额外注册的 Provider 动作当前不可动态发现。
- `DecisionProvider` 不执行上述动作。它在动态验证首帧 observation 和每个
  settled observation 后只输出 `act/done/blocked` Action Proposal；proposal 仍由
  动态协议校验并执行，最终三态只由 Result Judge 裁决。
- 历史 `EXECUTE_SHELL` 与内部 `HANDLE_PERMISSION_ALERT`、`HIDE_INPUT_METHOD` 只允许查看，不允许 AI 新增、更新、复制、导入或回放；CLI 不提供任意 Shell，也不会自动点击系统权限按钮。

## 会话和历史覆盖

| 所有权类型 | 创建或发现 | 查询 | 完成或清理 |
|---|---|---|---|
| 内部 ADB `requestId` | `adb-connect` | 命令内部轮询受控回执与 `doctor` | `connected` 或带人工处理提示的 `failed` |
| 回放 `runId` | `run`、`run-repeat`、`run-batch` | `status`、`result` | `cancel --run-id`，仅允许原始准确标识 |
| 动态 Agent `sessionId + ownerToken` | `agent-session-start` | `agent-status/observe/act/timeline` | `agent-end/cancel`；App 进程内会话，重启后不作为托管恢复依据 |
| 交互录制 `sessionId` | `record-start` | `record-status` | `record-stop` |
| 性能采集 `sessionId` | `perf-start` | `perf-status` | `perf-stop` |
| 性能实时监控 `sessionId` | `perf-display-start` | `perf-display-status` | `perf-display-stop` |
| 压力 `sessionId` | `stress-start` | `stress-status` | `stress-stop` |
| 独立录屏 `sessionId` | `screen-record-start` | `screen-record-status` | `screen-record-stop` |
| 相机扫码 `sessionId` | `scan-start` | `scan-status` | `scan-cancel` |
| 视频分析 `requestId` | `video-analysis-start` | `video-analysis-status` | 设备终态或有界失败 |
| 回放/性能历史 `id` | `*-history-list` | `*-history-get` | `*-history-delete` |
| 插件 `pluginId` / `requestId` | `plugin-list/install` | `plugin-list`、变更回执 | `plugin-remove`、重启确认 |
| 托管 task/shard/attempt/assignment | `managed-submit`、worker claim | `managed-status/events/report` | Result Judge 终态、取消或有界重试；主机 SQLite 持久，新 attempt 从测试入口重跑 |

所有停止、取消、删除和结果查询都必须绑定原始准确标识；最新记录不能替代目标记录。
Android 动态 Agent generation 约束 App 进程内旧回调；托管 `ownerGeneration` 则
fence 主机侧旧 assignment。Worker B 重新 claim 后只读取提交时持久化的
plan/decisions/serial，以新 attempt 和新 Android session 从测试入口重跑；它不继承
Worker A 的内存，旧 events/evidence 只用于审计。fencing 不能撤销 A 已产生的真实
UI 触摸，也不承诺物理副作用 exactly-once。

## 有意保留的边界

- `adb-connect` 可发起 SoloPi 内部 ADB 连接；系统权限、辅助功能、RSA 弹窗、MediaProjection 和相机权限仍由用户确认。
- 交互录制中的业务触控与扫码取景由用户完成；CLI 只管理所有权和证据。
- 插件管理不接受 URL，只处理用户明确提供的本地 ZIP；图片定位、图片断言和用例内录屏的回放执行路径在插件缺失时直接失败，不自动下载远程插件。
- 新安装默认不配置远程插件源；用户在 App 中明确配置远程源后，App 自身仍可能检查更新，这不属于 CLI 自动化能力。
- 不提供任意 Shell、任意 Scheme、任意 HTTP 或 Wi-Fi 控制后门。
- 性能图表和阈值属于展示或项目策略；CLI 提供原始 CSV、实时值、历史与描述统计，不虚构统一达标标准。
- 性能和录屏上传地址只能在 App 中配置；CLI 性能命令只保存或拉取本地证据，不自动上传。
- HTTP、HTTPS 与 `solopi://` 扫码内容只返回数据，固定 `contentExecuted=false`。
- Oracle 只是 checkpoint 的 selector/field/operator/expected 预期规则，不是数据库
  或 Agent 自评；Result Judge 是 `passed/failed/not_tested` 的唯一最终裁决主体。
  `not_tested` 还可能由前置条件、checkpoint 未到达、证据缺失或无法归因导致，
  不能统称为 Oracle 失败。
- 报告必须用同一次 run/attempt 的 observation、step、receipt、settled observation、
  timeline、checkpoint 和 cleanup 形成证据链。`outcomeFingerprint` 只摘要规范化
  裁决，不替代来源链，也不能用来把其他重试或独立性能会话的数据拼入本次结论。

这些边界仍属于功能映射的一部分。只有对应真机命令达到成功终态并保留证据，才能把本清单中的入口标记为本轮已验证。
