# GlassBox CLI 使用文档

GlassBox CLI 是 GlassBox 同一工程内的 Agent 调用入口，不是另一个独立应用。它用于让 Claude Code、Codex 等 Agent 平台发现组件、校验用例，并在后续阶段触发执行和读取报告。

## Agent 一条命令原则

CLI 的核心职责是让其他 Agent 通过一条命令完成一次完整执行。正常 Agent 不应先自行调用 `cases validate`、再解析组件、再选择设备、再启动 runner 或拼装报告；这些步骤由 CLI 内部统一完成。

```bash
# 单用例
glassbox run case <case-file-or-case-id> --json

# 多用例：一次提交、一个任务、一个报告
glassbox run task --case-id <caseIdA> --case-id <caseIdB> --json
```

CLI 内部会解析 live caseId/bundle/case-file，合并组件和 `caseEdges`，校验 schema、节点、设备绑定和必要字段，并在通过后只提交一次任务。校验失败时不启动 runner、不创建 task、不修改用户资产，返回 `phase=validation`、`validationSummary`、`validationErrors[]`、`validationWarnings` 和 `recoveryActions`。

通过后的任务结果必须在 CLI 最终 JSON、task 顶层、`task.summary` 和 `.glassreport` 的 `report.json.task` 中保留同一份 `validationSummary`。这样 Agent 只需读取一条命令的结果和唯一报告路径即可完成执行判断与复盘。

## CLI 任务与桌面 UI 实时一致

`run case` / `run task` 返回 `taskId` 后，同一任务会自动显示在桌面端“测试任务”列表：

- UI 已打开：Broker 推送任务创建、当前用例/步骤、running/success/failed/stopped 和最终报告状态，无需手动刷新。
- UI 后打开或窗口重新聚焦：从同一安装、同一 `userData` 的持久化任务索引恢复 running 与近期终态任务；丢失事件由增量同步回补。
- UI 与 CLI 展示同一 `taskId`、任务名、环境、用例数、设备、录屏/性能选项、开始/结束时间和 `reportPackage`。
- UI 的停止按钮复用 Broker 控制通道；报告页打开或导出的是同一 `.glassreport`。

保存 CLI 返回的唯一 `taskId` 并使用 `tasks show` / `reports show` 查询。禁止为了“让 UI 看见”再次提交用例，也禁止创建 UI 专属任务副本。

需要在多用例任务尚未结束时增量分析失败 case，使用：

```bash
"$GLASSBOX_CLI" tasks watch <taskId> --jsonl
"$GLASSBOX_CLI" tasks watch <taskId> --jsonl --after <revision|taskRevision|eventId>
"$GLASSBOX_CLI" reports show <taskId> --case-id <caseId> --json
```

`tasks watch` 输出可重放的 JSON Lines：`case_terminal` 只表示用例执行已结束，
不表示日志/录屏已封口；收到相同 caseId 的 `case_artifacts_ready` 且
`evidenceReady=true` 后，才可以消费 `runDir/logs/recordings/screenshots/performanceReports`
并提交证据。`task_terminal` 全任务只出现一次。任务仍有 pending/running case 时，
任务级状态保持 `running`（停止收敛阶段为 `stopping`），已有失败通过
`hasFailures=true` 和 `summary.failedCount` 表示；不要把中间失败当作任务终态。

## CLI / UI 一致性原则

CLI 和 UI 是同一个产品的两个入口。UI 能创建、查看、校验、运行、停止、导出或 review 的用例/任务，CLI 必须以同一语义支持，不能要求用户为了 CLI 单独改用例资产。

从 UI 持久化状态读取用例时，CLI 必须按 UI 规则解析：

```text
builtinComponents + state.components + bundle.components + case.components
```

同时要使用 UI 的 `caseEdges[caseId]`、`nodePositions`、设备绑定、环境配置和任务报告详情。任何 CLI 改动都要检查 `components list`、`cases show`、`cases validate`、`run case`、`run task`、`tasks show/reports show` 是否保持一致。

通用 ADB 组件支持 `acceptedExitCodes`、`onError=fail|continue|branch` 和声明式 `outputMapping`。映射只能使用 stdout/stderr/exitCode/signal/timedOut/success 及 trim、notEmpty、equals、regex、json、jsonPath 等安全转换写入 `variables.*`。`if` 节点读取 `variables.*` 或 `nodeOutputs.*`，按 `caseEdges` 的 `true`/`false`/`error` handle 选择路径。Flow 编辑器提供 IF 节点入口和可视化条件配置（equals/notEmpty/regex），不要求手写 raw JSON；旧 `yes`/`no` 边会在加载时迁移。`pidof` 查询应声明 `acceptedExitCodes:[0,1]`；空 stdout 是 running=false，不是 ADB 故障。

## 启动方式

Agent 只能使用用户已经安装并明确选定的 Glass Box。安装位置不固定；优先使用用户给出的路径，否则让 macOS 返回已登记应用：

```bash
GLASSBOX_APP="${GLASSBOX_APP:-$(osascript -e 'POSIX path of (path to application "Glass Box")' 2>/dev/null)}"
GLASSBOX_APP="${GLASSBOX_APP%/}"
GLASSBOX_CLI="$GLASSBOX_APP/Contents/Resources/bin/glassbox"
test -x "$GLASSBOX_CLI" || { echo "未找到用户已安装的 GlassBox CLI"; exit 64; }
"$GLASSBOX_CLI" --help
```

禁止执行源码 CLI、构建产物 CLI、候选包 CLI、解压或备份 App 内 CLI，也不得为了验证自行安装或复制 Glass Box。

## 命令总览

```bash
"$GLASSBOX_CLI" components list --json
"$GLASSBOX_CLI" components list
"$GLASSBOX_CLI" devices list --json
"$GLASSBOX_CLI" devices list
"$GLASSBOX_CLI" cases list --json
"$GLASSBOX_CLI" cases list --query "充话费" --json
"$GLASSBOX_CLI" cases show <caseId> --json
"$GLASSBOX_CLI" tasks list --json
"$GLASSBOX_CLI" tasks show <taskId> --json
"$GLASSBOX_CLI" reports list --json
"$GLASSBOX_CLI" reports show <taskId> --json
"$GLASSBOX_CLI" env get --json
"$GLASSBOX_CLI" env set PRE --json
"$GLASSBOX_CLI" cases validate ./case.json
"$GLASSBOX_CLI" cases validate ./case.json --json
"$GLASSBOX_CLI" run case ./case.json --json
"$GLASSBOX_CLI" run case ./case.json --json --env PRE
"$GLASSBOX_CLI" run case ./case-bundle.json --case-id <caseId> --json
"$GLASSBOX_CLI" run case ./case.json --phone <serial> --glasses <serial> --json
"$GLASSBOX_CLI" run case ./case.json --json --report-out ./reports/case.glassreport
"$GLASSBOX_CLI" run case ./case.json --json --perf phone
"$GLASSBOX_CLI" run case ./case.json --json --perf glasses
"$GLASSBOX_CLI" run case ./case.json --json --perf all
"$GLASSBOX_CLI" run case ./case.json --json --record-glasses-screen --show-glasses-screen
"$GLASSBOX_CLI" run task ./case-bundle.json --case-id <caseIdA> --case-id <caseIdB> --json
"$GLASSBOX_CLI" run task --case-id <caseIdA> --case-id <caseIdB> --json --perf all
```

除非在调试 CLI 本身，否则不要把逐条 `cases validate` 作为 Agent 执行前置流程；这会重复解析、重复选择设备，并破坏“一条命令、一个任务、一个报告”的产品契约。

## components list

列出 Agent 可复用的 GlassBox 当前组件。返回值包括 CLI 内置组件和 UI 全局组件库中的自定义组件。

```bash
"$GLASSBOX_CLI" components list --json
```

返回字段：

- `id`：写入用例步骤的 `componentId`。
- `name`：组件名称。
- `kind`：组件类型，例如 `adb`、`audio`、`tts_assert`、`json_assert`、`llm_assert`。
- `device`：默认执行设备，`phone` 或 `glasses`。
- `params`：组件参数定义和默认值。
- `timeoutSeconds`：默认超时时间。

Agent 生成用例时应优先复用这些组件，不确定动作使用 `wait` 节点加 `config.todo`。

CLI 的组件解析同时包含桌面端内置组件 `component-*`、节点模板组件 `template-*`、UI 全局组件库 `state.components` 和用例内联组件。从 UI 状态导出的用例如果引用全局自定义组件，`components list`、`cases validate`、`cases show`、`run case` 和 `run task` 都必须按同一套组件解析语义处理。

## devices list

列出 GlassBox 当前可识别的 ADB 设备。该命令是桌面端设备管理能力的 CLI 入口，Agent 不需要自己维护设备发现逻辑。

如果设置中心已经配置了 ADB 路径，CLI 会只使用这一个 adb；不会再遍历 Android SDK、Homebrew 或 PATH 中的其它 adb，避免多版本 adb client/server 冲突导致 USB 反复断连。

```bash
"$GLASSBOX_CLI" devices list --json
```

返回字段：

- `devices`：当前 ADB 设备列表，包含 `serial`、`state`、`model`、`product`、`device`、`kind`。
- `kind`：GlassBox 识别出的设备类型，取值为 `phone`、`glasses` 或 `unknown`。
- `source`：设备来源，`workflow-state` 表示来自 GlassBox 设备管理绑定，`adb` 表示来自当前 ADB 扫描。
- `defaults.phoneSerial`：默认可用于执行的手机序列号。
- `defaults.glassesSerial`：默认可用于执行的眼镜序列号。
- `adbPath`：实际使用的 adb 路径。若设置中心配置了 adbPath，这里应与设置中心一致。
- `warnings`：ADB 扫描失败等非阻断警告。若 GlassBox 已绑定设备，CLI 仍会返回默认设备。

当 `run case` 没有显式传入 `--phone` / `--glasses` 时，CLI 会优先使用 GlassBox 设备管理里绑定的设备；未绑定时再使用 ADB 自动识别出的默认设备。

## cases list / cases show

从 GlassBox 桌面端持久化状态中只读查询用例库，供 Claude Code、Codex 等 Agent 查找已有可执行用例、参考用例结构或导出单条用例详情。

列出用例：

```bash
"$GLASSBOX_CLI" cases list --json
```

按名称、描述、标签、文件夹路径等模糊搜索：

```bash
"$GLASSBOX_CLI" cases list --query "充话费" --json
```

可选过滤：

```bash
"$GLASSBOX_CLI" cases list --folder <folderId> --json
"$GLASSBOX_CLI" cases list --library <libraryId> --json
"$GLASSBOX_CLI" cases list --tag payment --json
"$GLASSBOX_CLI" cases list --review-status draft --json
```

返回摘要字段：

- `statePath`：读取到的 `workflow-editor-state.json`。
- `libraries` / `folders`：用例库和文件夹信息。
- `cases[].id` / `cases[].name`：用例 ID 和名称。
- `cases[].folderPath` / `cases[].libraryName`：所在目录，方便 Agent 定位业务域。
- `cases[].stepCount` / `cases[].edgeCount`：节点和连线数量。
- `cases[].runnable`：是否同时包含开始、结束和步骤。

查看单条用例：

```bash
"$GLASSBOX_CLI" cases show <caseId> --json
```

`cases show` 会返回：

- `case`：完整用例；CLI 会把当前状态中的组件合并到 `case.components`，方便 Agent 生成可执行草稿时引用。
- `components`：当前可用组件列表。
- `edges`：该用例在 UI 中真实执行的连线，来源于 `caseEdges[caseId]`。

执行图完整性：CLI 会在 normalize/filter 前检查原始边。缺失端点返回 `CASE_EDGE_ENDPOINT_MISSING`，不会创建 task、runner 或产生设备副作用。带边用例只沿图执行，断路/环分别返回 `WORKFLOW_PATH_TERMINATED_EARLY` / `WORKFLOW_CYCLE_DETECTED`；无边旧用例才按 steps 线性执行。报告中的 `plannedPath`、`executedPath`、`reachedEnd`、`terminationReason`、`failedEdge`、`duplicateStepId` 用于区分合法 IF 分支与异常重复。
- `nodePositions`：该用例节点坐标。
- `summary`：用例摘要。

注意：从持久化 UI 状态读取已有用例时，不要用 raw `case.steps[]` 判断执行顺序。真实执行顺序以 `edges` / `caseEdges[caseId]` 为准。

## tasks list / tasks show / reports list / reports show

从 GlassBox 桌面端持久化状态中只读查询自动化任务和可导入报告。`reports` 是 `tasks` 的报告视角别名，主要用于其他 Agent 快速找到最近可 review 的执行结果。

列出任务：

```bash
"$GLASSBOX_CLI" tasks list --json
```

列出报告：

```bash
"$GLASSBOX_CLI" reports list --json
```

按状态或关键词过滤：

```bash
"$GLASSBOX_CLI" tasks list --status failed --json
"$GLASSBOX_CLI" reports list --query "电影票" --json
```

查看任务或报告详情：

```bash
"$GLASSBOX_CLI" tasks show <taskId> --json
"$GLASSBOX_CLI" reports show <taskId> --json
```

停止正在运行的异步任务：

```bash
"$GLASSBOX_CLI" tasks stop <taskId> --json
"$GLASSBOX_CLI" tasks stop <taskId> --force --json
```

`tasks stop` 会通过正在运行的 headless/control channel 按 `taskId` 请求停止当前正在执行的 case，并阻止剩余 case 继续运行。它不要求用户打开 GlassBox UI 窗口。`--force` 只表示外部强制停止意图，不会删除任务、删除报告、杀 GlassBox 进程或执行 `adb kill-server`。

返回摘要字段：

- `id` / `name` / `status`：任务 ID、名称、状态。
- `caseIds`：本次任务包含的用例 ID。
- `summary.successCount` / `failedCount` / `stoppedCount` / `caseCount`：任务结果统计。
- `reportPackagePath`：可导入 `.glassreport` 路径，若存在。
- `reportRoot`：报告展开目录，若存在。
- `reportDetailPath`：任务详情 JSON 路径。
- `performanceOptions` / `performanceTargets`：性能采集配置和实际报告目标。
- `startOptions`：本次任务开始节点属性覆盖。

`tasks show` / `reports show` 会自动读取 `workflow-report-details/<taskId>.json`，把 UI 为了性能拆出去的 `cases`、节点结果、artifact、性能数据和任务事件加载回来。只有 `finishedAt` 已生成、全部 case 已收敛且无活动 case 的 `success` / `failed` / `stopped` 才是权威终态；对这类终态但缺少 `.glassreport` 的历史任务，`reports show` 可基于 detail 中的 runDir 产物懒生成报告包并回写 `reportPackagePath`。运行中的 `reports show --case-id` 始终只读，不生成完整 `.glassreport`。

运行中任务的 runner 探测使用 `alive` / `dead` / `unknown` 三态。只有明确确认进程已退出时才返回 `staleRunning:true` 和 `TASK_STALE_RUNNING`；`EPERM` 表示进程存在但当前用户无权发送信号，不能判死；`ps` 或其他探测失败返回 `TASK_RUNNER_LIVENESS_UNKNOWN`，保持任务为 running，且不得仅凭该结果建议或执行 `tasks stop --force`。

停止请求返回字段：

- `success`：停止请求是否已被桌面端接受。
- `taskId` / `status`：被停止的任务 ID 和当前停止中状态。
- `requestIds`：已发出取消信号的当前 case requestId。
- `stoppedRuntimeCount`：本次实际找到并清理的运行态数量。

## env get / env set

读取或切换手机端业务 SDK 环境，和桌面端顶部 PRE/ONLINE 环境切换使用同一套设备文件：

`/sdcard/Android/data/<phonePackage>/files/sdk_env`

支持环境值：

- `PRE`
- `GRAY`
- `STABLE`
- `ONLINE`

查询当前环境：

```bash
"$GLASSBOX_CLI" env get --json
```

切换到预发环境：

```bash
"$GLASSBOX_CLI" env set PRE --json
```

指定手机和包名：

```bash
"$GLASSBOX_CLI" env set ONLINE --phone <phoneSerial> --package com.rokid.sprite.aiapp --json
```

说明：

- 未传 `--phone` 时，CLI 使用 `devices list` 的默认手机。
- 未传 `--package` 时，env 命令使用设备管理中的手机默认包名；未配置时明确返回缺失，不猜业务包名。
- 如果设置中心配置了 ADB 路径，`env get/set` 只使用这一个 adb，不会扫描其它 adb 版本。
- `env set` 和 `run case/run task --env` 会先读取当前环境；如果已经是目标环境，默认不重复写入 `sdk_env`，也不重启目标手机 App。
- 只有环境确实不一致，或显式传入 `--force-env-restart` 时，CLI 才会写入 `sdk_env` 并重启目标手机 App。

## cases validate

校验 GlassBox 用例 JSON。

```bash
"$GLASSBOX_CLI" cases validate ./case.json
```

机器可读输出：

```bash
"$GLASSBOX_CLI" cases validate ./case.json --json
```

校验内容：

- 顶层结构是否为单用例、用例数组或 `{ "cases": [] }`。
- `schemaVersion` 是否为 `glassbox.workflow.v1`。
- 用例是否包含 `id`、`name`、`steps`。
- step 是否包含合法 `type`、`device`。
- `component` 步骤是否引用存在的组件。
- 组件必填参数是否缺失。
- 是否存在 `start` 和 `end`。
- 生成用例是否建议标记为 `reviewStatus=draft`。

## HTTP TTS 配置

GlassBox 支持在设置中心配置通用 HTTP TTS Provider。配置保存到本机环境配置中，CLI 和桌面端执行用例时共用同一份配置。

设计原则：

- 不绑定具体厂商，用户可配置任意 HTTP URL、Method、Headers 和 Body 模板。
- 请求模板支持变量：`${text}`、`${textJson}`、`${textUrlEncoded}`、`${format}`、`${sampleRate}`、`${sampleFormat}`、`${voice}`、`${voiceJson}`、`${voiceUrlEncoded}`、`${stepId}`。
- 响应支持三种形式：直接返回音频二进制、JSON 字段返回 base64、JSON 字段返回音频 URL。
- 合成后的音频会保存到本机 `~/Documents/GlassBoxData/tts-audio`，随后复用音频组件原有的 push 和触发命令。

推荐写法：先用 `tts_synthesize` 生成音频，再把生成的本地文件交给音频组件。不要在新用例里使用音频组件旧的 `sourceType=tts` / `ttsText` 路径。

```json
{
  "type": "tts_synthesize",
  "device": "phone",
  "config": {
    "nodeKey": "confirm_purchase_voice",
    "text": "确认购买"
  },
  "timeoutMs": 30000
}
```

```json
{
  "type": "component",
  "device": "phone",
  "componentId": "component-send-confirm-audio",
  "inputs": {
    "sourceType": "file",
    "localPath": "${variables.confirm_purchase_voice.audioPath}",
    "outputFormat": "pcm",
    "sampleFormat": "AV_SAMPLE_FMT_S16",
    "sampleRate": "16000"
  }
}
```

## Agent 推荐工作流

```bash
# 0. 每次 GlassBox 更新后，先重新读取 docs/agent/ 下的最新文档

# 1. 查看组件
"$GLASSBOX_CLI" components list --json > ./artifacts/glassbox-components.json

# 2. 查看设备
"$GLASSBOX_CLI" devices list --json

# 3. 根据 PRD 生成 case.json

# 4. 校验
"$GLASSBOX_CLI" cases validate ./case.json --json

# 5. 修复校验错误后再次校验

# 6. 用户确认后执行。执行前需确保 GlassBox 桌面端已经启动
"$GLASSBOX_CLI" run case ./case.json --json

# 如果文件里包含多个用例，指定 case id 执行
"$GLASSBOX_CLI" run case ./case-bundle.json --case-id <caseId> --json

# 多用例自动化任务，推荐用 run task
"$GLASSBOX_CLI" run task ./case-bundle.json --case-id <caseIdA> --case-id <caseIdB> --json
```

## 用例文件示例

```json
{
  "schemaVersion": "glassbox.workflow.v1",
  "id": "draft-payment-invalid-code",
  "name": "[草稿] 扫码支付无效码兜底",
  "reviewStatus": "draft",
  "tags": ["draft", "ai-generated", "payment"],
  "defaults": {
    "phonePackage": "com.rokid.sprite.aiapp",
    "glassesPackage": "com.example.wearable"
  },
  "variables": {
    "expectedTtsText": "请重新扫码"
  },
  "steps": [
    {
      "id": "start",
      "name": "开始",
      "type": "start",
      "device": "phone",
      "config": {
        "capturePhoneLog": true,
        "captureGlassesLog": true
      }
    },
    {
      "id": "launch",
      "name": "拉起测试页",
      "type": "component",
      "device": "phone",
      "componentId": "component-launch-test-page",
      "inputs": {
        "packageName": "${defaults.phonePackage}",
        "activity": "com.example.test.TestActivity"
      },
      "timeoutMs": 10000
    },
    {
      "id": "assert-log",
      "name": "提取并校验无效码日志",
      "type": "component",
      "device": "glasses",
      "componentId": "component-tts-text-assert",
      "inputs": {
        "extractRegex": "result=(?<ttsText>[^,]+)",
        "expectedText": "scanpay invalid code",
        "matchOperator": "equals",
        "caseSensitive": "true",
        "clearBeforeStart": "true",
        "extractVariableEnabled": "true",
        "extractVariableName": "scanResult"
      },
      "timeoutMs": 10000
    },
    {
      "id": "end",
      "name": "结束",
      "type": "end",
      "device": "phone",
      "config": {
        "cleanupAudioFiles": true
      }
    }
  ]
}
```

## 退出码

- `0`：命令成功。
- `1`：命令参数错误或校验失败。
- `2`：文件读取/解析失败。

Agent 应根据退出码和 `--json` 输出判断是否需要修复用例。

## run case

触发 GlassBox 执行一个单用例。参数可以是本地 case/bundle JSON 文件，也可以直接是 GlassBox 用例库里的 `caseId`。

`run case` 是单用例快捷入口，内部会转换成单用例 `run task`，复用同一条单实例后台 Broker 提交通道。它不再使用旧 HTTP bridge，也不会把 `caseId` 当成本地文件路径。

`run case` / `run task` 不要求用户手动前台打开 Glass Box UI。CLI 会启动或复用用户选定安装的同一个 Glass Box 主实例：UI 未运行时进入隐藏 Broker 模式，UI 已运行时把 payload 转交现有实例；用户点击 App 时隐藏 Broker 会提升为桌面 UI且不中断任务。

CLI `run case` / `run task` 任务提交只有一条通路：

- 单实例 Broker：CLI 向已安装的 Glass Box App 传入任务 payload，由同一主实例串行创建并执行任务。

硬性规则：桌面主进程不再监听网络端口承接 CLI 请求；任务提交失败时，只排查 headless runner 提交结果、`taskId`、`tasks show`、本地执行权限、ADB 和 scrcpy。

Agent 不要设置旧 runner 环境变量，也不要为了执行 CLI 先手动 `open -a "Glass Box"`，否则会把 UI 拉到前台。直接运行 `"$GLASSBOX_CLI" run case ...` 或 `"$GLASSBOX_CLI" run task ...`，由 CLI 自动后台启动 headless runner。若 Agent 沙箱限制本地进程/ADB/scrcpy，请按 skill 使用沙箱外/提权方式运行 CLI。

只有开发者验证未打包的本地源码改动时，才使用 `npm run dev`。普通用户或交付给其他 Agent 的场景，不要要求源码环境启动桌面端。

```bash
"$GLASSBOX_CLI" run case ./case.json --json
"$GLASSBOX_CLI" run case case-1781428205609-c96fd8 --json
```

可选参数：

- `--case-id <id>`：从多用例文件、用例数组或 `{ "cases": [] }` 包裹文件中选择一个用例执行。
- `--phone <serial>`：指定手机设备。未指定时自动使用 `devices list` 识别出的默认手机。
- `--glasses <serial>`：指定眼镜设备。未指定时自动使用 `devices list` 识别出的默认眼镜。
- `--env PRE|GRAY|STABLE|ONLINE`：执行用例前先切换手机端业务 SDK 环境。CLI 会先读取当前环境，只有不一致时才写入 `sdk_env` 并重启目标手机 App。
- `--force-env-restart`：配合 `--env` 使用，即使当前环境已匹配，也强制写入 `sdk_env` 并重启目标手机 App。普通自动化不要默认使用。
- `--phone-package <package>` / `--glasses-package <package>`：可选，仅覆盖本次执行包名；省略时逐条使用用例配置，再回退到设备默认值，不写回用例库。步骤不依赖包名时无需填写。
- `--env-package <package>`：仅指定环境文件所属手机包，不覆盖执行包。省略时使用本次 phone-package（若传），再取用例手机包、设备默认值。
- `--keep-screen-awake` / `--no-keep-screen-awake`：本次执行覆盖开始节点“屏幕常亮”选项。
- `--record-glasses-screen` / `--no-record-glasses-screen`：本次执行覆盖开始节点“保存眼镜录屏”选项。
- `--record-phone-screen` / `--no-record-phone-screen`：本次执行覆盖开始节点“保存手机录屏”选项。
- `--show-glasses-screen` / `--no-show-glasses-screen`：本次执行覆盖开始节点“展示眼镜投屏”选项。
- `--no-screen-mirror`：兼容旧参数，等价于本次执行 `--no-show-glasses-screen`。注意这不等于禁用录屏。
- `--report-out <file>`：指定可导入报告包输出路径。扩展名建议使用 `.glassreport`。
- `--no-report`：显式跳过报告包生成。Agent 默认不要使用这个参数。
- `--perf phone|glasses|all`：执行自动化任务时采集手机、眼镜或两者性能。可重复传入，也支持逗号分隔，例如 `--perf phone,glasses`。
- `--perf-phone` / `--perf-glasses`：分别开启手机/眼镜性能采集，等价于 `--perf phone` / `--perf glasses`。
- `--perf-interval-ms <ms>`：性能采样间隔，默认 `5000`，最小 `1000`。
- `--perf-phone-package <package>` / `--perf-glasses-package <package>`：覆盖性能采集目标包名；默认读取用例 `defaults.phonePackage` / `defaults.glassesPackage`。
- `--perf-phone-runtime android|harmony` / `--perf-glasses-runtime android|harmony`：覆盖采样运行时；默认 `android`。

默认情况下，`run case` 每次都会尽量生成一个可导入的 `.glassreport`：

- 正常执行成功或业务节点失败时，报告会包含节点结果、日志、录屏和执行产物。
- CLI 结果无法解析成标准 JSON 时，仍会生成 fallback 报告，把原始 stdout/stderr 放进失败节点，方便 review。
- 用例选择失败、校验失败、设备选择失败、文件读取异常等执行前错误，也会生成报告。
- JSON 输出中的 `reportPackage.path` 是最终可导入报告路径。Agent 执行后必须把这个路径反馈给用户。
- 使用 `--perf` 开启性能采集时，报告会在自动化任务顶层写入 `performanceOptions` 和 `performanceReports`，导入后复用 UI 端现有“自动化任务报告”页里的手机/眼镜性能卡片与趋势弹窗。
- 使用开始节点覆盖参数时，报告会在自动化任务顶层写入 `startOptions`。这些参数只影响本次 CLI 执行，不会修改用例文件或用例库里的开始节点配置。
- JSON 输出会包含 `devices`，这是本次运行实际使用的手机/眼镜序列号、包名和 adb 来源。其他 Agent 后续查看日志、定位设备或关联报告时必须优先使用这个字段，不要重新执行 `adb devices` 自己猜设备。

多用例文件示例：

```bash
"$GLASSBOX_CLI" run case ./movie-ticket-cases.json --case-id draft-movie-one-shot-purchase --json
```

如果自动识别失败，可以先查看设备：

```bash
"$GLASSBOX_CLI" devices list --json
"$GLASSBOX_CLI" run case ./case.json --phone <phoneSerial> --glasses <glassesSerial> --json
```

返回 JSON 与桌面端 workflow runner 保持一致：

```json
{
  "success": false,
  "results": [
    {
      "stepId": "launch",
      "stepName": "拉起测试页",
      "status": "failed",
      "error": "error: device not found"
    }
  ],
  "artifacts": {
    "runDir": "/path/to/logs/workflow-runs/xxx",
    "logs": [],
    "recordings": [],
    "screenshots": []
  },
  "reportPackage": {
    "success": true,
    "path": "/path/to/logs/workflow-runs/xxx/example.glassreport",
    "taskId": "cli-draft-case-1782964800000",
    "taskName": "CLI 执行 · [草稿] 示例用例",
    "caseCount": 1
  },
  "performanceOptions": {
    "phone": true,
    "glasses": false
  },
  "performanceReports": {
    "phone": {
      "id": "task-performance-phone-1782964800000-abcd",
      "target": "phone",
      "name": "[草稿] 示例用例 · 手机性能报告",
      "createdAt": "2026-07-02T12:00:00.000Z",
      "runtime": "android",
      "serial": "phone-serial",
      "packageName": "com.rokid.sprite.aiapp",
      "samples": []
    }
  },
  "devices": {
    "phone": {
      "serial": "phone-serial",
      "packageName": "com.rokid.sprite.aiapp",
      "source": "workflow-state"
    },
    "glasses": {
      "serial": "glasses-serial",
      "packageName": "com.example.wearable",
      "source": "workflow-state"
    },
    "adbPath": "/path/to/configured/adb"
  }
}
```

实现说明：真实自动化任务应使用 `run task`。`run task` 不要求 UI 桌面端预先启动，会后台启动已安装的 Glass Box App 作为 headless runner，并由 runner 创建任务和执行用例。桌面主进程不监听网络端口，也不提供文件桥接入口。Agent 沙箱中如果本地进程/ADB/scrcpy 受限，应提权/沙箱外运行 CLI。

## run task

触发 GlassBox 创建并运行一个多用例自动化任务，报告结构与 UI 端自动化任务报告保持一致。Agent 需要执行多个用例时，优先使用 `run task`，不要自己循环多次 `run case` 拼结果。

从文件中选择多个用例：

```bash
"$GLASSBOX_CLI" run task ./case-bundle.json --case-id <caseIdA> --case-id <caseIdB> --json
```

从当前 GlassBox 用例库中按 ID 选择多个用例：

```bash
"$GLASSBOX_CLI" run task --case-id <caseIdA> --case-id <caseIdB> --json
```

带任务名、环境、性能和开始节点覆盖：

```bash
"$GLASSBOX_CLI" run task ./case-bundle.json \
  --case-id <caseIdA> \
  --case-id <caseIdB> \
  --task-name "支付回归任务" \
  --env PRE \
  --perf all \
  --record-glasses-screen \
  --show-glasses-screen \
  --json
```

可选参数基本与 `run case` 一致：

- `--case-id <id>`：可重复传入；未传且提供文件时，执行文件内全部用例。
- `--task-name <name>`：指定任务名。
- `--phone <serial>` / `--glasses <serial>`：指定设备。
- `--env PRE|GRAY|STABLE|ONLINE`：任务开始前切换一次环境；当前环境已匹配时不会重复写入或重启。
- `--force-env-restart`：强制重写环境并重启手机 App。
- `--keep-screen-awake` / `--record-glasses-screen` / `--record-phone-screen` / `--show-glasses-screen` 等开始节点覆盖参数：只影响本次任务，不修改原用例。
- `--perf phone|glasses|all`：采集任务级性能。
- `--wait`：前台等待任务完成并在最终 stdout 输出完整任务 JSON 和 `.glassreport`。等待期间 CLI 会向 stderr 输出 `glassbox.cli.progress.v1` JSON Lines，不会污染最终 stdout JSON。
- `--report-out <file>`：指定 `.glassreport` 输出路径。

`run task` 默认是异步提交：CLI 会启动 headless runner，并返回 `success:true`、`submitted:true`、`taskId` / `task`、`devices` 和 `submission.type:"headless"`。UI 桌面端不需要预先启动。旧版本可能同时包含 `bridge.type:"headless"` 兼容字段，不应把它理解为 HTTP/File bridge 提交通道。默认异步提交不会在提交命令内立刻生成 `.glassreport`；任务进入 `success` / `failed` / `stopped` 终态后，运行端会自动生成可导入报告包并把 `reportPackagePath` 写入任务详情。任务完成后用 `tasks show <taskId> --json` 或 `reports show <taskId> --json` 读取最终状态、报告详情和报告包路径。

如果调用方需要一次命令拿到可导入 `.glassreport`，使用 `--wait`。`--wait --json` 的最终 stdout 仍是一个完整 JSON；等待期间的 progress 事件会写到 stderr，例如：

```json
{"schemaVersion":"glassbox.cli.progress.v1","stage":"task_request_prepared","taskId":"cli-task-1783338641609","route":"/workflow/run-task"}
{"schemaVersion":"glassbox.cli.progress.v1","stage":"headless_runner_start","taskId":"cli-task-1783338641609","submissionType":"headless"}
{"schemaVersion":"glassbox.cli.progress.v1","stage":"headless_runner_submitted","taskId":"cli-task-1783338641609","submissionType":"headless"}
```

Agent 看到 `headless_runner_submitted` 时，表示任务已经提交并可查询。不要因为 stdout 暂时没有最终 JSON 就重复提交同一任务。

默认异步提交的任务可以用返回的 `taskId` 停止：

```bash
"$GLASSBOX_CLI" tasks stop <taskId> --json
```

停止后继续用 `tasks show <taskId> --json` 或 `reports show <taskId> --json` 查看最终落盘状态。

## 后台启动桌面端

读取眼镜 `glass_biz_config.json` 时，只有 ADB `cat` 明确返回远端文件不存在才会自动创建父目录并写入 `{}`；离线、未授权、权限错误、其他 ADB 失败和非法 JSON 会保留为错误结果，不会被初始化逻辑掩盖。初始化写入不重启眼镜应用。

CLI 执行不要求用户手动打开 GlassBox。`run task` 会自动启动或复用已安装 APP 的单实例后台 Broker 并提交任务。用户和 Agent 不需要手动传启动参数，也不应该为提交任务手动 `open -n` 或制造第二实例；用户需要查看 UI 时正常点击/打开 Glass Box 即可提升现有 Broker。

从 JSON 文件提交时，相对音频路径以该 case/bundle 文件所在目录为基准。基目录会写入任务快照并由 Broker 继续使用；真实缺失返回 `AUDIO_ASSET_NOT_FOUND`，validation 阶段零 task、零 runner、零设备副作用。

```bash
"$GLASSBOX_CLI" run case ./case.json --json
```

不要手动 `open` Glass Box。直接调用用户既有安装内 `"$GLASSBOX_CLI"`，由它管理同一安装的 headless runner；Agent 不应自行拼装内部启动参数。
- 这个参数由 CLI 内部使用，不需要用户或 Agent 手写。
# 本地更新单条用例

支持此入口的客户端和 CLI 必须同时更新（0.1.103 安装包尚不支持）。

```bash
solopi-desktop cases show <caseId> --json
solopi-desktop cases update <caseId> --file /absolute/path/case.json --json
```

文件支持单个用例对象，或 `cases show --json` 返回的对象（修改其中的 `case`）。
按 ID 更新已有用例，不新建、不访问 Git、不执行用例，不需要版本号。
未提供的用例字段保持不变；`steps` 和 `components` 若提供则替换对应数组。
未提供 `edges` / `nodePositions` 时保留；删除或重命名节点时应同时更新连线。
组件只保存到该用例的快照，不改全局组件。

应用打开时先更新页面内存，再由主进程保存；成功回执 `uiUpdated:true` 后，页面及
`cases show` 均可看到新内容。应用关闭时由后台主进程保存，`uiUpdated:false`，下次打开可见。
`--dry-run` 仅校验，不保存。更新失败返回非零状态；超时先 `cases show` 确认结果再重试。
这是直接更新：指定字段以 JSON 为准，不做版本管理；不要拿旧的完整导出覆盖新修改。

## 本地新增单条用例（0.1.105 起）

```bash
solopi-desktop cases create --file /absolute/path/case.json --library <libraryId> --folder <folderId> --dry-run --json
solopi-desktop cases create --file /absolute/path/case.json --library <libraryId> --folder <folderId> --json
```

`--library` 必填，`--folder` 可省略以存入库根目录；库和文件夹必须已经存在。
支持单个用例对象、`{case, edges, nodePositions}`，或仅含一条用例的
`{cases:[case], caseEdges:{caseId:edges}, nodePositions:{caseId:positions}}` bundle。
用例必须提供新 `id`，重复 ID 明确失败，不覆盖。组件保留在用例自身，连线及坐标保留。
经主进程与页面保存，回执包含 `caseId/libraryId/folderId/uiUpdated`；用 `cases show <caseId> --json` 回读。
不运行用例，不执行 Git 同步，不需要先在页面建立空白用例。旧客户端需安装新包后使用。

## Codex 压测接入

安装 solopi-desktop 后运行包内 CLI：

```bash
SOLOPI_DESKTOP_CLI="/Applications/solopi-desktop.app/Contents/Resources/bin/solopi-desktop"
"$SOLOPI_DESKTOP_CLI" skills install codex --json
"$SOLOPI_DESKTOP_CLI" run task --case-id CASE_ID --stress-rounds 100 --json
"$SOLOPI_DESKTOP_CLI" run task --case-id CASE_A --case-id CASE_B --stress-minutes 30 --stress-logs all --json
"$SOLOPI_DESKTOP_CLI" tasks show TASK_ID --json
"$SOLOPI_DESKTOP_CLI" tasks stop TASK_ID --json
```

更新已安装 Skill 使用 `skills install codex --force --json`，替换 glassbox-cli 目录；新建 Codex 会话加载。轮数/分钟数互斥，范围1–100000整数。每轮执行全部选中用例；到时完成当前用例后结束；失败仍继续后续轮次。连续日志可选phone/glasses/all/none，默认glass，录屏默认关闭。纯PC隔离任务指定none。依赖自己的用例、设备、外部工具及相应授权。旧客户端先查看run task --help，不支持参数时升级，禁止用普通任务冒充压测。

## 配置、耗电日志和独立性能采集

以下命令由当前版本 solopi-desktop 后台运行时承载，返回结构化 JSON；安装版 CLI 与 App 必须同时更新。配置差量写入与桌面设置共用存储，页面在线时等待编辑器保存确认。`config get` 遮蔽 API Key 和请求头；不要将其返回的占位符写回配置。组件修改影响全局组件定义，单个用例配置仍使用既有用例编辑命令。

```bash
solopi-desktop config get --json
solopi-desktop config patch --file patch.json --dry-run --json
solopi-desktop config patch --file patch.json --api-key-env MODEL_API_KEY --json
```

`patch.json` 只填写要修改的字段。通过 `id` 更新或新增模型/组件；修改已有对象时其他字段和凭据保持原值。新增对象必须补齐必填字段。模型/组件可一起提交，TTS 必须单独提交。校验失败不写入。

```json
{
  "model": {
    "id": "my-model",
    "name": "我的模型",
    "baseUrl": "https://example.com/v1",
    "model": "model-name"
  },
  "selectedModelId": "my-model"
}
```

组件差量示例：`{"component":{"id":"existing-component-id","timeoutSeconds":30}}`。支持名称、描述、类型、设备、命令模板、参数、标签、超时和结果断言校验；参数数组按完整数组替换。TTS 示例：`{"tts":{"enabled":true,"url":"https://example.com/tts","timeoutMs":30000}}`，沿用已保存的请求模板、`headersText`、参数及响应映射，响应类型为 `json-url`。API Key 用环境变量传入可避免出现在命令参数中；不要把凭据写进版本库。

```bash
solopi-desktop battery import --serial DEVICE_SN --json
solopi-desktop battery import --file /absolute/path/bugreport.zip --json
solopi-desktop battery import --file /absolute/path/batterystats.log --json
solopi-desktop battery status JOB_ID --json
solopi-desktop battery cancel JOB_ID --json
solopi-desktop battery history --json
solopi-desktop battery show REPORT_KEY --json
```

支持 ZIP/TXT/LOG。导入立即返回 `id`（jobId），后台采集和解析；从设备采集完成前保持连接。状态包括 `collecting/parsing/saving/completed/failed/cancelled/interrupted`，不在状态回执中重复返回完整报告。`history` 返回 reportKey（`key`）和保留的日志 `sourcePath`；`show` 返回完整分析结果。重启后仍能查询已保存状态与历史报告；异常中断的任务明确返回 interrupted，不自动重跑。CLI 同时只运行一个耗电导入，不取消桌面页面自己的导入。

```bash
solopi-desktop performance start --serial DEVICE_SN --package org.example.app \
  --role glasses --runtime android --duration 60 --interval 5 --json
solopi-desktop performance status TASK_ID --json
solopi-desktop performance stop TASK_ID --json
solopi-desktop performance report TASK_ID --json
```

独立性能采集无需事先编写用例，使用通用等待工作流承载采集，返回唯一 `taskId` 并自动出现在测试任务列表。支持 `phone/glasses` 和 `android/harmony`，时长 5–3600 秒、采样间隔 1–60 秒；默认 glasses/android/60 秒/5 秒。包名指向已运行进程，命令不负责启动应用。CPU、内存、线程和设备电池温度复用现有性能报告，采集失败保留诊断；电池温度是否可用取决于设备运行时。状态、停止和报告分别复用 `tasks show/stop`、`reports show`。隔离执行仍受 UI 同步能力门禁约束，退出应用会停止所属任务。


### 断言卡点策略

所有断言组件（日志文本、JSON 日志、LLM 日志、手机 UI 元素）支持节点级 `config.assertBlocking`。省略或 `true` 为卡点，保持旧用例行为；设置 `false` 时，该断言未通过、超时或执行异常均按节点成功继续，不因此影响用例或任务成败。用户主动停止仍终止执行；任务提交前的配置与设备校验保持不变。

```json
{ "type": "component", "componentId": "component-json-log-assert", "config": { "assertBlocking": false } }
```

Flow 侧栏“是否卡点”直接保存在当前节点的 `config`，不修改共享组件。CLI 的用例导入/更新/导出和运行共用同一配置。结果 `meta.assertion` 记录 `blocking`、`outcome`（`matched` / `timeout` / `error`）、`passed` 与 `continued`；非卡点超时的原始原因、最近未通过原因等仍保留在报告中。执行成功不等于断言命中，review 时应同时读取该结构化结果。

## 按用例执行状态查询

只要失败用例清单时，一次执行：

```bash
"$SOLOPI_DESKTOP_CLI" reports show <taskId> --status failed --limit 20 --json
```

`tasks show` 支持相同参数。这里 `--status` 过滤任务内的用例，支持 `failed|success|running|stopped|pending|all`，可重复或逗号分隔；先过滤再按 `--offset`/`--limit` 分页（默认20，最多50）。新筛选输出在 `task.cases`，整轮 `task.summary` 不随过滤改变；`totalCaseCount` 是整轮数量，`matchedCaseCount` 是匹配数量，`nextOffset=null` 才表示已覆盖全部匹配项。无匹配返回空列表，不代表任务不存在。与 `--case-id` 同用时取交集。

Agent 原生工具等价调用 `read_task_report({taskId,statuses:["failed"],view:"cases",limit:20})`，默认返回完整case记录分页及 returnedCaseCount、matchedCaseCount、nextOffset、selectionComplete，不带附件和性能资料。nextOffset非空继续按case分页，不把清单当字符片段检索。附件链接与性能摘要显式用 view:"summary"，失败节点/录屏诊断用 view:"details" 或单用例 read_case_results。整批分析清单完成后调用 validate_case_coverage({taskId,rows:[{caseId,name,status,category}]}) 核对漏项、重复、名称与状态；待分类必须保留。该校验不证明业务分类或根因正确。errorTruncated=true时完整错误在单用例详情。

已安装旧CLI未升级时先核对真实help，不向旧CLI传未知筛选参数后把全量结果误当作筛选成功。

## 随业务采集性能与独立性能采集

“跑用例并抓性能”使用同一次 `run case/run task --perf glasses|phone|all`，或同一次 Agent `submit_task.performanceOptions`；采集随业务任务结束，无需额外询问独立采集时长，也不另开 `start_performance` 等待任务。平台支持随业务采集，不能因报告为空就断定入口不存在。

Agent 原生参数示例（设备与包名使用本次核验的真实值）：

```json
{"performanceOptions":{"glasses":true,"intervalMs":5000,"targets":{"glasses":{"serial":"<在线SN>","packageName":"<实际应用包名>","runtime":"android"}}}}
```

手机对应 `phone:true` 与 `targets.phone`，可同时开启两端。`enabled:true` 不是合法性能开关，`{}` 不启用采集。提交后核对回执实际 `performanceOptions` 的phone/glass及targets；`performanceAcknowledged=false` 或缺少配置时不能宣称已开启。终态再核查性能报告样本与诊断；任务提交成功、配置被接受都不等于采样成功。缺失历史性能不能靠事后独立采集补回，也不因缺数据自动重跑业务。

只有用户单独要求采集当前应用的一段性能时，才使用 `performance start` / Agent `start_performance`；它不执行业务用例，采集时长属于这一独立任务。设备电池温度不是应用耗电量，耗电报告另用日志导入/分析流程。


## 按实际设备互斥执行

- 外部提交任务直接指定手机 SN 和眼镜 SN：`solopi-desktop run task --case-id <CASE_ID> --phone <PHONE_SN> --glasses <GLASSES_SN> --json`。单用例也可用 `run case <CASE_ID>` 搭配相同参数；只需一端时仅传对应端。先用 `devices list --json` 核对本次在线设备，不从历史记录猜 SN。
- 同一个 Broker 允许设备集合互不重叠的任务并行；任一实际 SN 重叠就返回 `TEST_TASK_BUSY`，包含 `activeTask`、`activeTasks` 和 `conflictingDevices`。手机和眼镜角色不同也不能共用同一物理设备。占用覆盖待启动、运行、停止和全部日志/录屏/进程收尾。
- 显式 SN 覆盖本次执行副本中的用例默认 SN，不修改库内用例；省略端仍使用用例默认设备，因此省略参数不代表没有占用。回执 `reservedDeviceSerials` 给出本任务完整占用集合（包括性能目标）。性能采样与本次指定端必须使用相同 SN，否则拒绝提交。
- 每个成功提交保存各自的 taskId，分别用 `tasks show <taskId> --json`、`tasks watch <taskId> --jsonl` 跟踪。已知 taskId 不重复提交。Agent 工具 `submit_task` 使用 `devices:{phone:{serial:PHONE_SN},glasses:{serial:GLASSES_SN}}`。
- 收到 `TEST_TASK_BUSY` 仅查询/订阅占用任务，等待收尾或按用户授权显式停止；不循环提交，不通过另开实例、隔离数据目录、改变会话或手工 ADB 执行用例绕过。旧版本全局拒绝并行时先升级，不靠额外进程绕过。
- Docker/远程 ADB 路由必须支持本次显式 SN。若设备不可用或适配器不支持，报告配置错误并修复路由；禁止把用例步骤改成手工 push、广播或 shell 执行来替代平台任务。框架锁只仲裁本 Broker，不能保证其他平台未占用同一设备。

## 用例库 Git 配置与同步

`cases libraries --json` 查询库 ID、仓库与分支。`cases configure --library <id|唯一名称> --repo <URL> --branch <branch> [--name <name>] --dry-run --json` 预览配置，去掉 `--dry-run` 保存；创建新库必须显式加 `--create`。未提供的字段、凭据和已有用例保持原值。

`cases pull --library <id> --dry-run --json` 预览远端用例导入；`cases push --library <id> --message <message> --dry-run --json` 预览用例和素材提交。去掉 `--dry-run` 执行实际操作；推送需用户明确授权。上述写入口统一经过 Broker 和在线 UI 保存确认，不能直接改 userData。拉取预览可读取远端和缓存，但不写用例；配置预览不访问远端。

Agent 原生工具对应 `case_library_list`、`case_library_configure`、`case_library_pull`、`case_library_push`，不是 `quick_action_export_git`；后者仅推快捷操作。完整参数和跨平台调用见 `skills/solopi-desktop-cli/references/case-library-git.md`。另一台机器未提交的本地编辑不会通过 Git 拉取自动同步，必须先核对来源版本和素材。

### Preserve source samples during migration

For an explicitly requested exact migration, `cases update <id> --file <case.json> --preserve-source-samples --dry-run --json` can retain mismatched sampleLog/sampleExtractText metadata and return sampleDiagnostics. Use the same explicit flag to save after reviewing the diagnostic receipt. The default editing path remains strict. Invalid regex syntax and unreadable assets still fail; all runtime assertions and business expectations remain unchanged. This option does not execute cases or certify a migrated case as passed. Do not edit the source machine to satisfy a destination sample warning.
