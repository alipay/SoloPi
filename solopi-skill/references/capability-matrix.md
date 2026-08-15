# SoloPi 能力矩阵

本矩阵按当前 Skill 自带 CLI 的 100 个顶层命令整理能力入口，不代表真机验证结论。只有在目标设备上完成相应命令、状态机终态和证据核验后，才能把该项标记为本次任务已验证。

## 状态说明

| 状态 | 含义 |
|---|---|
| 直接 CLI | 存在类型化顶层命令；仍须以 `capabilities` 和本次真机结果确认设备支持。 |
| 直接 CLI + 用户确认 | CLI 负责有界会话与证据，但系统权限弹窗必须由用户在设备上确认。 |
| 用例间接 | 可通过动作步骤写入、导入并回放，没有独立顶层命令；必须真机跑到终态。 |
| 需用户交互 | CLI 可准备或观察部分流程，但权限确认、真实触控、相机或系统界面必须由用户完成。 |
| 暂不可安全自动化 | 当前没有满足所有权、校验或回滚要求的安全 CLI；不得用任意 Shell、Scheme 或 HTTP 绕过。 |

## 十个能力域

| 能力域 | 具体能力 | 状态 | 当前入口与边界 |
|---|---|---|---|
| 1. 设备与动作 | 设备、安装、权限和协议诊断 | 直接 CLI | `doctor`、`capabilities`；核对内部 ADB、悬浮窗、电池优化和辅助功能，只诊断、不静默授权。`background` 仅是提示型状态。 |
| 1. 设备与动作 | SoloPi 内部 ADB 连接初始化与终态核验 | 直接 CLI + 用户确认 | `adb-connect` 只在内部 `adb` 为唯一缺口时发起应用既有连接流程，按 `requestId` 轮询并重新核对 `doctor`；RSA 弹窗仍由用户确认，不执行 `adb tcpip 5555`。 |
| 1. 设备与动作 | 应用、版本、运行状态、页面树 | 直接 CLI | `apps`、`app-info`、`app-status`、`inspect`；查询结果不是业务验证。 |
| 1. 设备与动作 | 66 个安卓枚举与 6 个内置动态 ActionProvider 动作契约 | 直接 CLI | `actions` 返回当前源码的离线编写契约，不访问设备；6 个动作由三个 Android `ActionProvider` 实现发布，插件、权限和真机可执行性仍需另证。它们不是 AI 控制层的 `DecisionProvider`。 |
| 1. 设备与动作 | 52 个可编写普通回放动作 | 用例间接 | 55 个枚举在步骤结构上可出现，但 `EXECUTE_SHELL`、`HANDLE_PERMISSION_ALERT`、`HIDE_INPUT_METHOD` 只允许查看且不得校验、导入或回放；高风险动作需逐阶段确认。 |
| 1. 设备与动作 | 插件新增的入口和 Provider 动作动态枚举 | 暂不可安全自动化 | App 会运行时扫描插件类；当前 `capabilities`、`plugin-list` 和 `actions` 没有发布这些动态入口或参数契约，不得把内置清单冒充设备发现。 |
| 1. 设备与动作 | 系统权限、辅助功能和 RSA 授权确认 | 需用户交互 | 用户在设备系统界面确认；CLI 不自动点击或修改安全设置。 |
| 1. 设备与动作 | 持久设备注册、真实能力/健康探测和设备池匹配 | 直接 CLI | `managed-device-register/probe/list`；调度只选择健康且满足 API、能力和标签的设备，degraded/offline/quarantined 不参与。 |
| 2. 用例 | 列表、详情、导出、模板、校验、导入 | 直接 CLI | `cases`、`case-get`、`case-template`、`case-validate`、`case-import`；导入按 `requestId` 核对。 |
| 2. 用例 | 删除 | 直接 CLI | `case-delete`；先备份，按准确用例名和 `requestId` 核对，不可逆。 |
| 2. 用例 | 多参数生成与清除 | 直接 CLI | `case-get` 导出后，使用 `case-validate --running-params-file` 写入并校验 `SEPARATE/UNION`，或用 `--clear-running-params` 清除；检查输出后再以 `case-import --replace` 更新准确用例。 |
| 2. 用例 | 导出用例的步骤查看、添加、更新、删除、移动和复制 | 直接 CLI | `case-step-*` 只生成新的本地文件，复用完整用例校验；结构通过不等于真机回放通过。 |
| 2. 用例 | 复杂录制器结构 | 用例间接 | 复杂录制器生成结构应保留原样，不手工猜测。 |
| 3. 录制 | 创建、状态、停止交互录制 | 直接 CLI | `record-start`、`record-status`、`record-stop`，按准确 `sessionId` 管理。 |
| 3. 录制 | 业务触控、文本输入和结束时机 | 需用户交互 | 用户在手机上真实操作；CLI 不得声称代替人工完成录制。 |
| 4. 回放 | 单次、重复、批量执行及本次目标/重启覆盖 | 直接 CLI | `run`、`run-repeat`、`run-batch`；每个子运行保留独立 `runId`。回放请求绑定预检得到的 `caseId` 与 SHA-256 指纹，同名用例被替换时拒绝启动。 |
| 4. 回放 | 状态和取消 | 直接 CLI | `status`、`cancel --run-id`；只有当前活动运行与任务保存的原始 `runId` 一致时才能取消。 |
| 4. 回放 | 动态 Agent observe/act/settle 闭环 | 直接 CLI | `agent-session-start/observe/act/status/timeline/pause/resume/end/cancel`；动作绑定 `sessionId + ownerToken + observationId + stepId`，仅开放 7 个 typed action，共享回放租约并保留逐步证据。 |
| 4. 回放 | cloud/on-device DecisionProvider Action Proposal | 直接 CLI | `verify-run --decision-provider` 在首帧和每个 settled observation 后调用 provider；provider 只提议 `act/done/blocked`，没有设备执行、租约管理或最终裁决权限。 |
| 4. 回放 | 需求/AC 到验证计划 | 直接 CLI | `verify-normalize/compile/validate` 纯本地生成 Goal Tree、Test Intent IR、三种路由和固定用例；`verify-run` 复用固定回放与动态 Agent。 |
| 4. 回放 | 持久队列、矩阵调度、generation 租约、worker 与崩溃恢复 | 直接 CLI | `managed-submit/status/events/cancel/recover/worker-*`；主机持久 task/attempt 与 Android 进程内 session 分离。Worker B 不继承 A 的内存；它读取持久 plan/decisions/serial，以新 attempt 从测试入口重跑，旧 events/evidence 只审计。`ownerGeneration` 拒绝迟到写入，但不承诺 UI 物理副作用 exactly-once。 |
| 4. 回放 | 签名端侧模型安装、激活、回退、推理和 cloud/on-device 决策切换 | 直接 CLI | `model-*` 与 `verify-run --decision-provider`；ExecuTorch companion 当前证明 Counter 离散策略的 CPU/XNNPACK 工程链路，不代表通用 GUI 模型已生产可用。模型只输出 Action Proposal。 |
| 4. 回放 | 7 个录制/远控/回放界面控制枚举 | 暂不可安全自动化 | 不作为普通步骤；使用类型化生命周期命令，不直接写入用例。 |
| 5. 结果与证据 | 精确终态结果 | 直接 CLI | `result --run-id`；只接受匹配的终态，只有 `passed` 算通过。 |
| 5. 结果与证据 | 运行证据包 | 直接 CLI | `run --artifacts` 生成结果、屏幕和日志；异步运行需终态后单独取证。 |
| 5. 结果与证据 | AI 验证统一三态报告 | 直接 CLI | `verify-run --artifacts` 的 Result Judge 是唯一最终裁决主体；Oracle 只是 checkpoint 的确定性预期规则/字段。`not_tested` 表示未到达、缺证据或不可归因等，不能笼统称 Oracle 失败；Agent `done` 不能直接判定通过。 |
| 5. 结果与证据 | 同一次运行证据链与可比结果摘要 | 直接 CLI | 结论沿 `plan -> task/shard/attempt -> session/observation/step -> receipt/settled observation/timeline -> checkpoint/cleanup -> Result Judge -> report/digest` 反查。`outcomeFingerprint` 只比较规范化裁决摘要，不证明证据来自同一次运行，也不能拼接其他 attempt 或性能会话。 |
| 5. 结果与证据 | 多设备汇总、稳定 CI 退出码和持久 evidence digest | 直接 CLI | `managed-report` 与受 Bearer 鉴权的 `managed-serve`；服务重启后任务/事件/attempt 仍可查询，owner secret 不落报告。 |
| 5. 结果与证据 | 独立截图与日志 | 直接 CLI | `screenshot`、`logs`；可能覆盖同名文件并包含敏感数据。 |
| 5. 结果与证据 | 回放历史列表、受限详情与精确删除 | 直接 CLI | `replay-history-list/get/delete`；详情中的大文件和日志仅返回有界内容，删除不可逆且必须等待匹配回执。 |
| 5. 结果与证据 | App 历史结果的完整目录导出 | 需用户交互 | App 可导出完整截图、日志、步骤、设备和动作文件；当前 CLI 没有按不透明 `id` 拉取整个目录的安全入口，不得用 `run --artifacts` 冒充。 |
| 6. 性能 | 指标发现和即时值 | 直接 CLI | `perf-list`、`perf-current`；可发现不等于设备已满足权限或指标已验证。 |
| 6. 性能 | 实时监控、当前值和精确停止 | 直接 CLI | `perf-display-start/status/stop`；会话独占性能服务，按准确 `sessionId` 返回租约绑定的 `values` 并清理，不能接管 App 手工面板或性能录制。 |
| 6. 性能 | 采集、状态、停止和 CSV 拉取 | 直接 CLI | `perf-start`、`perf-status`、`perf-stop`，按准确 `sessionId` 管理。 |
| 6. 性能 | 本地 CSV 描述性统计 | 直接 CLI | `perf-analyze` 支持 UTF-8/GBK，逐列输出样本数和分位统计；明确跳过非数值列，不判断达标。 |
| 6. 性能 | Activity Manager 冷启动或暖启动耗时 | 直接 CLI | `startup-time`；固定使用 `am start -W`，自动解析 Launcher，严格输出逐轮字段和统计；不是视频差分视觉完成时间。 |
| 6. 性能 | 性能历史列表、详情与精确删除 | 直接 CLI | `perf-history-list/get/delete`；使用不透明 `id`，删除前先保存需要的详情。 |
| 6. 性能 | 端侧模型冷启动、首决策、P50/P95、PSS、功耗、准确率和任务成功率门禁 | 直接 CLI | `model-benchmark` 绑定包与设备；`model-release-check` 要求 cloud/on-device 共享语料证据并按签名 manifest 阈值 fail closed。 |
| 6. 性能 | 通用 App 性能阈值、基线和图表 | 暂不可安全自动化 | 普通性能 CLI 只提供原始数据、描述性统计与历史管理；端侧模型使用独立签名门禁契约。 |
| 7. 压力 | 有界 CPU/内存加压、状态、停止 | 直接 CLI | `stress-start`、`stress-status`、`stress-stop`；有限时长、准确 `sessionId`、失败路径也清理。 |
| 7. 压力 | 任意进程或 Shell 加压 | 暂不可安全自动化 | 不提供任意 Shell，不得绕过 CPU、内存和持续时间上限。 |
| 8. 录屏与扫码 | 启动耗时录屏的用例动作 | 用例间接 | 动态 Provider 的 `startRecordScreen`/`stopRecordScreen`；依赖插件、录屏权限和完整参数。 |
| 8. 录屏与扫码 | 独立录屏、状态、停止与 MP4 拉取 | 直接 CLI + 用户确认 | `screen-record-start/status/stop`；用户确认 MediaProjection 弹窗，使用准确 `sessionId`，只从 `capturesRoot` 拉取非空 MP4。 |
| 8. 录屏与扫码 | 受控 MP4 视频差分视觉响应耗时 | 直接 CLI | `video-analysis-start/status`；只分析 `ScreenCaptures` 直属非空 MP4，按准确 `requestId` 返回终态，不自动下载插件。 |
| 8. 录屏与扫码 | 录屏系统授权 | 需用户交互 | 用户确认系统录屏授权；CLI 不静默点击，`pending-user-confirmation` 不是录屏已开始。 |
| 8. 录屏与扫码 | 生成二维码、条码 | 用例间接 | `generateQrCode`、`generateBarCode` 动作；敏感内容需授权。 |
| 8. 录屏与扫码 | 相机扫码会话、状态、只读结果与取消 | 直接 CLI + 用户确认 | `scan-start/status/cancel`；相机权限和取景由用户完成，按准确 `sessionId` 管理。HTTP、HTTPS 和 `solopi://` 内容只返回数据，固定 `contentExecuted=false`。 |
| 8. 录屏与扫码 | 相机权限 | 需用户交互 | 用户在系统界面确认；CLI 不静默授权，`pending-camera-permission` 不是扫描完成。 |
| 9. 插件 | 内置动态动作契约 | 直接 CLI | `actions` 列出源码内置的 6 个 ActionProvider 动作契约；回放图片或录屏动作前必须由 `plugin-list` 证明本地插件已加载，缺失时停止且不触发远程下载。DecisionProvider 不属于插件动作目录。 |
| 9. 插件 | 已安装列表、本地文件安装与精确移除 | 直接 CLI | `plugin-list/install/remove`；安装自动计算 SHA-256 并清理受控暂存，移除使用稳定 `pluginId`。插件是动态代码，`completed_restart_required` 后必须明确报告重启风险。 |
| 9. 插件 | 远程 URL 安装、自动下载与无重启生效 | 暂不可安全自动化 | CLI 只接受用户指定的本地 ZIP，不接受 URL；安装或移除后不伪造已无重启加载。 |
| 10. 设置与元信息 | 17 个类型化设置的列表、读取、修改 | 直接 CLI | `config-list`、`config-get`、`config-set`；只允许已发布键、类型和范围，写后只读确认。 |
| 10. 设置与元信息 | 版本、设备、协议和许可证标识 | 直接 CLI | `app-info` 仅查询元信息；完整 `NOTICE.html` 和帮助链接仍在 App 查看。 |
| 10. 设置与元信息 | 加密密钥和数据根目录切换 | 需用户交互 | `writable=false`；数据根目录设置不等于自动迁移，必须在 App 界面核对。 |
| 10. 设置与元信息 | 全局参数等敏感配置 | 需用户交互 | 当前值脱敏且 `writable=false`；只允许在 App 界面查看和修改。 |
| 10. 设置与元信息 | 性能/录屏上传地址、远程插件源和内部 ADB 地址 | 需用户交互 | 四项固定 `writable=false`；它们会外发数据、加载动态代码或改变连接目标，只能在 App 中明确配置。新安装的远程插件源默认为空。 |
| 10. 设置与元信息 | 任意配置键或控制端口热切换 | 暂不可安全自动化 | 未发布键必须拒绝；当前会话不直接修改控制端口。 |

## 使用规则

1. 先用本矩阵选择路径，再读取相应专题参考。
2. “直接 CLI”只证明存在受约束入口；检查 `capabilities`、命令退出码、准确标识、终态和产物后再报告本次已验证。
3. “用例间接”必须完成结构校验、导入、真机回放和证据核验，不能只凭动作出现在 `actions` 中宣称支持。
4. “需用户交互”应明确告诉用户手机上需要完成的动作，并在用户完成后继续查询状态。
5. “暂不可安全自动化”不得以兼容脚本、任意 Shell、原始 Scheme、HTTP 变更或 UI 自动点击规避。
