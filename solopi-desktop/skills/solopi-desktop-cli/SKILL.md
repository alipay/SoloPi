---
name: solopi-desktop-cli
description: 使用用户已安装的 solopi-desktop CLI 配置模型/TTS/通用组件，导入耗电日志、查询报告，独立采集性能，并运行、追踪或复核已有自动化用例。适用于已知 caseId、已有用例名称/目录、多用例任务、按轮数或时长压测、任务状态、运行中持续发现新增失败 case 和 .glassreport 查询。可离线转换导入 SoloPi 历史用例；不用于编写、克隆、编辑或修复业务用例。
---
# solopi-desktop CLI 快速运行
Skill ID 为 `solopi-desktop-cli`，命令示例使用 `solopi-desktop`。`SOLOPI_DESKTOP_DATA_DIR` 可显式指定数据目录；旧 `GLASSBOX_CLI_DATA_DIR`、报告协议和历史数据目录继续兼容，不搬移历史任务和凭据。

设备术语统一为 **smart glasses / 眼镜设备**，角色为 `glasses`。CLI 使用 `--glasses`、`--glasses-package`、`--record-glasses-screen`；JSON 使用 `devices.glasses`、`defaults.glassesSerial`、`defaults.glassesPackage`、`recordGlassesScreen`。这是当前唯一设备契约，不使用单数角色或把眼镜称为“玻璃端”。外部 SDK 的原生包名、类名和配置文件名按其真实协议填写。
运行/复核已有用例、清理任务记录、CLI配置及独立采集时加载本 Skill。正常路径只读本文件，不读取 `references/`，也不加载业务用例编写 Skill。
## 按需使用与失败恢复

当前入口已提供完整 schema 或本轮已读过相同版本帮助时，直接使用，不固定重复 `--help`、`discover_tools`、`doctor` 或其他 Skill。已确认且未变化的设备和查询范围可复用；重新连接、设备切换、用例成员变化或明确要求刷新时才重新核对。任务提交自身仍执行统一校验与互斥。

- 已知 taskId 直接查询该任务；需要搜索其他任务时可显式传 query/状态/分页，不因历史 taskId 限制新查询。
- 多例步骤可用read_task_report(caseIds, view="steps")一次取精简执行表，原始stdout/日志按缺口再读。
- 分析先读失败清单，再按真实 taskId/caseId/stepId 读取缺口；不要为了完整性把全部日志、配置和 Skill 逐页读完。
- `read_evidence` 的 source 是本证据范围，单例证据不包含其他用例。`found=false` 是当前范围内字面检索未命中，不代表业务没有结果或并发冲突；换成正确证据来源，而不是重复顺序读。alreadyRead 回执提供原调用索引，只有确需原文才回读或 refresh。
- Skill 重载失败只修复当前调用依赖的 Skill。无关历史 Skill 消失不应阻断普通命令；不能靠 echo/ping 或改命令包装试探门禁。相同错误且没有新信息时停止重试，给出未完成状态和恢复动作。
- 内置 Agent 已使用 update_work_state 时，用 finish_work 引用本轮实际回执明确 completed 或 blocked；普通 CLI 和普通问答无需额外建工作状态。执行成功不等于业务通过，收尾必须说明实际结果；已有成功/未知写入先查回执，不能重放。

## 任务清理与入口版本

在 solopi-desktop Agent 中，当前工具目录若有 `clean_tasks`，直接使用原生工具按明确 `taskIds` 或 `query/status/before/olderThan` 删除；`dryRun` 可选，不需要 `planToken` 或 `refresh`，不向用户索取登录凭据。默认保留产物；只有用户要求释放产物时才传 `purgeArtifacts=true`，超过默认50条显式设置 `limit`。

外部 CLI 按该实际可执行文件的帮助确认是否支持 `tasks remove` / `tasks clean`。安装版 CLI 与正在运行的开发版 App 可能不同：旧 CLI 不支持删除，不能据此推断当前 Agent 原生工具也不支持。历史错误与历史帮助只代表当时入口；当前参数以最新工具 schema 为准，参数校验失败按 validation 修正，不将额外字段当作必要条件。原生工具可用时无需转 CLI、手改 userData 或让用户手动清列表。

## 快捷操作

用户要求切换环境、捞取历史日志或执行已配置脚本时，优先使用通用快捷操作，业务逻辑由脚本定义，不自行拼业务命令或新建测试用例。参数未知且没有本轮有效帮助时再查 `quick-actions --help`；用 `quick-actions list --query <名称> --json` 发现并 `show <id> --json` 读取完整参数，然后 `query` 或 `execute --phase run --values <JSON> --phone <SN> --glasses <SN> --json`；仅传本次需要且已确认在线的设备。新建、从本机/仓库导入、差量配置、仓库推送及会话型操作见 [快捷操作](references/quick-actions.md)。不支持此命令的旧App需更新，禁止通过UI私有接口或猜脚本参数绕过。

## 按实际设备互斥执行

- 外部任务用 `--phone SN --glasses SN` 指定在线设备；不重叠可并行，同SN含收尾互斥，`TEST_TASK_BUSY` 不重提或绕过。省略端沿用默认设备，核对 `reservedDeviceSerials`；[完整规则](references/device-concurrency.md)。
- 包名默认沿用用例配置，缺省取设备默认值；无明确换包需求，不传 `--phone-package` / `--glasses-package` 或 Agent `devices.*.packageName`。扫描结果、历史任务不能作为覆盖理由；包名非必填，见[包名选择](references/package-selection.md)。

## SoloPi 历史用例与录制
用户要求导入或录制 SoloPi 用例时，读取[转换与录制用法](references/solopi-import.md)。转换生成可编辑草稿；待处理节点不能直接执行，不能把成功导入当成业务通过。

## 用例库 Git
配置、拉取、推送使用 `cases configure/pull/push` 或 Agent `case_library_*`；不等同快捷操作导出或提交测试。[用法](references/case-library-git.md)。

## 云端安装边界

本 Skill 可独立安装，运行、互斥、压测和订阅规则包含在本文件及其 references 中，不依赖其他 Skill 或私有工具平台。安装 Skill 不等于安装桌面执行器；云端使用目标机器已部署的统一 CLI 入口，不自行下载旧版裸 CLI 或转换现有业务用例。用户要求提报问题时，按其选择的缺陷平台和已安装工具提交；未配置外部平台时先交付报告与证据，不假定某个内部服务可用。

## 最快路径

1. 使用用户指定或部署已配置的唯一 CLI 入口；按下面的平台说明发现，不扫描旧包、备份和临时目录。
2. 运行设备用例前执行一次 `devices list --json`，按下方设备门禁确认本次设备；已知 caseId 再执行一次 `run case` 或 `run task`。
3. 只知道名称/目录：执行一次 `cases list --json` 解析 caseId，再执行一次 `run task`。
4. 保存唯一 `taskId`；长任务默认异步。用当前 UI 数据目录的 `tasks show` 核验同一任务已登记、状态一致；隔离执行也不能例外。
5. 终态返回 `reportPackage.path`；不得重复提交来“刷新”状态或让 UI 看见任务。

## 发现 CLI：按平台选择

用户明确给出的 CLI 路径或 `SOLOPI_DESKTOP_CLI` 优先，后续查询和提交始终复用同一入口及数据目录。

**Linux / SSH / 云端 Agent**：先从当前执行进程的 PATH 解析 `solopi-desktop`；品牌迁移期间若只部署了 `lenswiper`，使用部署确认的该入口。不要因普通 SSH 的 PATH 不同就断言云端入口不存在；也不要直接改用某个旧包的 `resources/bin`，这样可能丢失部署绑定的数据目录和设备路由。支持的发行包自带 Electron/Node、ADB、scrcpy、FFmpeg；后台任务自动处理无显示运行，调用方不安装 Xvfb、不设置 DISPLAY、不添加 sandbox/GPU 参数。缺入口或运行能力时交付结构化错误，由安装部署流程修复，不在执行业务时临时 `sudo apt install`。

```bash
SOLOPI_DESKTOP_CLI="${SOLOPI_DESKTOP_CLI:-$(command -v solopi-desktop || command -v lenswiper)}"
test -n "$SOLOPI_DESKTOP_CLI" || { echo "未找到已部署 CLI，请核对安装入口"; exit 64; }
"$SOLOPI_DESKTOP_CLI" devices list --json
```

**Windows**：使用部署提供的 CLI 启动器或 PowerShell `Get-Command solopi-desktop` 的结果，不使用 macOS `.app` 路径或 Linux shell 启动参数。

**macOS**：未指定 CLI 时才使用下述已登记应用发现方式。

用户已给路径时直接使用；否则让 macOS 返回已登记应用：

```bash
SOLOPI_DESKTOP_APP="${SOLOPI_DESKTOP_APP:-${GLASSBOX_APP:-}}"
if [ -z "$SOLOPI_DESKTOP_APP" ]; then
  SOLOPI_DESKTOP_APP="$(osascript -e 'POSIX path of (path to application "solopi-desktop")' 2>/dev/null)"
fi
SOLOPI_DESKTOP_APP="${SOLOPI_DESKTOP_APP%/}"
test -n "$SOLOPI_DESKTOP_APP" || { echo "未找到 solopi-desktop，请提供已安装应用的路径"; exit 64; }
SOLOPI_DESKTOP_CLI="$SOLOPI_DESKTOP_APP/Contents/Resources/bin/solopi-desktop"
test -x "$SOLOPI_DESKTOP_CLI" || SOLOPI_DESKTOP_CLI="$SOLOPI_DESKTOP_APP/Contents/Resources/bin/glassbox"
test -x "$SOLOPI_DESKTOP_CLI" || { echo "未找到用户已安装的 solopi-desktop CLI"; exit 64; }
```

默认只运行选定的部署入口，不自行安装、替换 App 或猜测数据目录覆盖。只有用户明确授权源码联调/自动修复闭环时，按[隔离开发执行](references/development-runner.md)使用受支持入口；普通运行不从源码、build、release、备份或挂载卷绕过部署。

`doctor --json` 不是固定初始化步骤。仅在找不到安装、CLI 入口异常、版本不一致或 dataDir 疑似漂移时按需执行。

遇到 `WORKFLOW_STATE_UNAVAILABLE` 或空 `statePath`，先核对当前入口与部署数据目录，不判定用例库丢失，不复制库文件或手拼 standalone case。`CASE_NOT_FOUND` 才表示在可读状态中没有该 ID。`doctor` 展示构建标识、数据目录及运行策略；`executionVerified:false` 明确表示没有执行真实任务，不能把诊断成功当成执行成功。已有候选/确认 taskId 时先查询原任务，不靠重新提交验证环境。

## 一条命令运行

设备门禁：最近一次有效的 `devices list --json` 中本次必需设备（含 PC 命令引用）必须 `state=device`；`bound` 仅为历史绑定。默认设备离线、角色 unknown 或多设备歧义时，按[设备选择与止损](references/troubleshooting-runner-and-adb.md#提交前设备选择与止损)处理，不直接提交。纯 PC 不要求无关设备；ACK 核对设备及必需包名，异常正常 stop，禁止自动重提。
已知单个 caseId：

```bash
"$SOLOPI_DESKTOP_CLI" run case <caseId> --json [--env PRE|GRAY|STABLE|ONLINE]
```

已知多个 caseId，一次提交、一个任务、一个报告：

```bash
"$SOLOPI_DESKTOP_CLI" run task \
  --case-id <caseIdA> \
  --case-id <caseIdB> \
  --json [--env PRE|GRAY|STABLE|ONLINE]
```

已知名称或目录时，只做一次发现：

```bash
"$SOLOPI_DESKTOP_CLI" cases list --json
"$SOLOPI_DESKTOP_CLI" run task --case-id <resolvedCaseId...> --json [--env PRE]
```

目录可能嵌套；只在需要递归解析目录时读取
[`references/case-discovery-and-library-sync.md`](references/case-discovery-and-library-sync.md)。

不要在真实运行前调用 `cases validate`。CLI 的内部 validation gate 会统一解析 caseId/bundle/file、组件、边、设备和必填字段；失败时零 task、零 runner、零设备副作用。

## 压测与 Codex 安装

用户要求压测、安装或更新 Codex Skill 时，读取[压测参数与 Skill 安装](references/stress-and-codex-install.md)。
压测使用一次 `run task --stress-rounds N` 或 `--stress-minutes N`，不使用 shell 循环；先核对已安装 CLI 支持参数，未指定轮数/时长时询问用户。

## 执行结果先交付

仅要求执行/重跑已有用例时，不自行扩展为修复用例、逐条根因分析或日志编码排查。任务终态后先调用一次 `tasks result <taskId> --json`，按结构化 counts/status/reportPackagePath 交付；此查询由代码生成摘要，不需要模型重写整份报告。用户另有分析要求时，再按失败 case/step 和同次时间边界读取必要证据。未知结论明确保留，不因没查清某个根因而扣住已完成结果。

`run task --json` 的提交回执提供顶层 `taskId`，任务元数据在 `task` 下；`tasks show --json` 为 `task.*`，`tasks result --json` 是顶层 `taskId/taskName/status/counts`。不要按同一种层级解析所有回执。`validationSummary.passed` 是提交前校验通过数，不能作为业务成功数；业务结果取 `counts.success/failed`。不确定字段时只打印一次 JSON 键或使用结果入口，不重新提交。

模型回复超限、超时、连接中断后，用已保存 taskId 查询 `tasks result` 恢复交付，不重新运行测试，也不自动重发已经完成的写操作。`success=true` 且 `successScope=query` 仅表示查询成功，执行成败看 `status`；`countsComplete=false` 或 `passRatePercent=null` 表示不能据此推断完整通过率。

本入口需要当前 CLI 支持；旧版本按已有 `reports show --summary --json` 读取摘要，不向旧 CLI 猜参数。默认异步提交；等待不通过无限循环全文读取报告。调用 CLI 优先直接传参数，避免用临时 Python 包装；确需分析脚本时通过脚本文件和显式路径参数传入，不依赖未导出的 REPORT/REPORT_PATH 环境变量。

## 异步任务与 UI

长任务不要使用 `--wait`。默认异步提交后保存 `taskId`：

```bash
"$SOLOPI_DESKTOP_CLI" tasks show <taskId> --json
"$SOLOPI_DESKTOP_CLI" tasks result <taskId> --json
"$SOLOPI_DESKTOP_CLI" tasks stop <taskId> --json
```

CLI 通过已安装 App 的单实例后台 Broker 统一仲裁设备占用。UI 未运行时 Broker 隐藏且不抢焦点；用户打开 App 时提升同一实例，任务不中断。

CLI 返回 `taskId` 后，桌面端“测试任务”自动显示同一任务：

- UI 已开：创建、当前用例/步骤和终态通过 IPC 推送。
- UI 后开、重新聚焦或事件丢失：从同一 `userData` 的持久任务索引增量回补。
- 正式 UI/CLI 必须共享可见的 taskId、进度、停止和报告；显式开发快照例外，保存在临时目录且不进入正式列表，通过 prepare 返回的同一 dataDir 查询/停止，终态默认7天过期。不得按任务名称猜开发态。
- UI 可查看详情并通过 Broker 控制通道停止；禁止为 UI 创建第二条任务。

## 运行中增量发现失败

用户要求边跑边分析或发现失败立即提单时，提交后按[增量 review](references/incremental-task-review.md)订阅 `tasks watch <taskId> --jsonl` 并续接 revision。使用已落盘的报告与证据分析，不等待整轮，不重复提交或自动停止。

## 可选运行参数

按需添加：

```bash
--task-name "<name>" --record-glasses-screen --record-phone-screen
--show-glasses-screen --perf phone|glasses|all --perf-interval-ms <ms>
--thread-stacks --stack-mode manual|interval|checkpoint|failure # 有开销，默认关闭
```

录屏、性能和报告细节仅在相关请求或异常时读取
[`references/recording-performance-and-reports.md`](references/recording-performance-and-reports.md)。

## 最小安全边界

- 本次用例若向眼镜写入测试配置（如 `glass_biz_config.json`），任务结束后（成功、失败或正常停止）须确认同一文件已重置为 `{}` 并回读；只清本任务写入的配置，不删除文件、不恢复旧 Mock。没有已验证的 finally 清理时，Agent 在终态且设备无其他任务后补清理；离线或失败明确报告残留，不自动重启重连。普通结束节点不能保证失败时清理。

- 两条及以上用例必须一次 `run task`；禁止 shell 循环多次 `run case`。
- 不修改业务用例，不手工拼 bundle，不预先逐条 validate，不重复选择设备。
- 不运行 `adb start-server`/`kill-server` 作为固定前置，不猜设备 serial。
- 不用 `open -n`、HTTP/File bridge 或第二个 App 实例。
- CLI/ADB/scrcpy 受 Codex 沙箱限制时，在确认没有已提交 taskId 后才使用获批环境执行一次，禁止先失败一次再重复提交。
- 修改、克隆、创建或修复业务用例时停止使用本快速路径，按用户提供的用例规范编辑；只运行既有用例时不要额外加载编写材料。

组件、执行图、变量、资产或 validation 诊断只在编写/修复用例时读取
[`references/case-authoring-and-validation.md`](references/case-authoring-and-validation.md)。

## 批量编辑入口

用户要求批量修改已有用例时，根据用户提供的用例规范，优先脚本批量改本地文件，避免模型逐条输出完整 JSON。内置 Agent 可使用 `export_cases` → `run_command` → `save_cases_from_file`；它们不是 CLI 子命令。仅有 CLI 时的文件提交方式及失败恢复见 [用例编写与校验细节](references/case-authoring-and-validation.md)。仅运行既有用例不触发编辑。

## 场景路由

| 场景 | 操作 / 按需资料 |
|---|---|
| 已知一个 caseId | 一次 `run case` |
| 已知多个 caseId | 一次 `run task` |
| 只有名称/目录 | 一次 `cases list`，再一次 `run task` |
| 查询任务/报告 | `tasks show` / `reports show` |
| 查目录或同步 Git 用例库 | `case-discovery-and-library-sync.md` |
| ACK、runner、ADB、stop 异常 | `troubleshooting-runner-and-adb.md` |
| 创建/修改/修复用例 | `case-authoring-and-validation.md` + 用户的用例规范 |
| 录屏、perf、报告重建 | `recording-performance-and-reports.md` |
| 打包或验候选 App | `packaging-and-installed-app-boundary.md` |

打包任务才读取
[`references/packaging-and-installed-app-boundary.md`](references/packaging-and-installed-app-boundary.md)；普通运行禁止读取。

## 简短回执

只返回：

- `taskId` 与当前/终态 `status`
- 实际 `devices.phone.serial` / `devices.glasses.serial`
- 首个失败因果（仅失败时）
- 唯一 `reportPackage.path`（终态存在时）



## 查询、诊断和性能采集

只查失败清单使用 `reports show <taskId> --status failed --limit 20 --json`，按 `nextOffset` 翻页；不读取无关全量证据。详细过滤、非卡点断言解释、诊断包导出和性能参数见[任务诊断与性能](references/task-diagnostics-and-performance.md)。
跑用例并采性能使用同次 `run task --perf glasses|phone|all` / `submit_task.performanceOptions`，不另开独立性能任务。配置确认不等于采样成功，终态核查报告。
离线正则生成见[离线断言诊断](references/offline-log-assert.md)；模型/TTS/组件配置及日志导入见[配置与采集](references/cli-services.md)。

## 当前用例范围与最短提交链

- 当前有效用例只以平台 `list_cases` / `read_case` / CLI `cases list/show` 为准；Git 工作副本、旧导出和历史对话不代表当前清单。删除后不能从旧文件恢复ID；`CASE_NOT_FOUND` 不解释为索引未加载。
- 内置 Agent：一次 `list_cases({libraryId, excludeFolderIds, excludeCaseIds})`，直接 `submit_task({selectionId: result.selectionId, ...任务选项})`。凭证覆盖整个查询集合，非仅当前页，提交前仍核对真实成员；同集合不同查询方式不构成新范围。旧版本无 selectionId 时沿用同范围的 total/selectionRevision，不抄分页ID、不为运行导出用例。
- CLI对应：`cases list --library ID --exclude-folder FOLDER --exclude-case CASE --json`，然后 `run task --library ID --exclude-folder FOLDER --exclude-case CASE --expected-count N --selection-revision HASH --json`。排除参数可重复；只在当前CLI help支持时使用。不要将库范围与文件或case-id混用。
- 范围/成员变化则重新查询，未变化不重复查询；重复目录/ID不重复执行。所选用例不存在或范围为空时不提交任务。
- 提交校验失败优先读 `validationGroups` / `validationSummary`，按根因核对实际受影响组件，完整逐用例证据按code/caseId读取；warning不阻断，不能为运行请求擅自改用例、跳过失败项或弱化校验。已有明确范围和参数，不重复向用户确认。
