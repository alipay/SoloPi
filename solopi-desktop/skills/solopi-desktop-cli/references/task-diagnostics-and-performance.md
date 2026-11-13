# 任务诊断、结果查询与性能采集

## 任务结果交付与模型失败恢复

`solopi-desktop tasks result <taskId> --json` 提供固定结构的精简回执，失败清单默认10条、最多20条，`--offset`/`--limit` 分页。该命令不运行模型、不启动设备操作，也不修改任务状态；业务失败时查询仍正常退出，按返回的执行 status/counts 判断。stdout 不含用例完整定义、stdout/stderr 或日志正文。

先返回 taskId、执行状态、counts、通过率及报告位置，再处理已明确要求的根因分析。单条原因未确认时仍交付整轮已确认结果。分析失败后继续查询同一 taskId；不能重提任务来恢复回复。`counts.unknown`、`countsComplete` 和空通过率保留数据缺口，不把缺失结果算作成功。

当前内置 Agent 在读取任务结果后发生后续模型异常，会从本轮已完成操作回执直接追加平台结果，同时保留异常；不调用模型补写，不重放工具。云端 Claude Code/其他第三方运行时不受桌面这个兜底控制，须在其宿主层接入相同的结构化结果和错误后恢复逻辑。

## 导出 solopi-desktop 自身运行诊断

用户反馈 Agent 请求、压缩或运行异常时，用 `solopi-desktop logs export --output /absolute/solopi-desktop-logs.json.gz --json` 导出排障包。无需设备和应用在线，不启动测试或上传数据。默认在当前目录生成唯一文件，不覆盖已有文件。让用户把该文件发给排查人员。

包内仅包含新版本采集的模型请求/响应结构、长度、结束原因、token统计、错误代码与Agent状态元数据；不包含聊天正文、推理正文、附件、配置凭据或设备业务日志。旧版本故障不能追溯补录，records为0时须升级重启、复现、再导出。解压gzip后为JSON，可直接程序读取。

## 离线日志正则诊断

给定日志原文和目标提取内容生成正则、验证 JSON 解析或断言时，读取[离线正则生成与试跑](offline-log-assert.md)。无需查询设备、任务或整库；不因诊断自动修改用例。先用 `assert --help` 核实当前安装支持该入口。
配置模型/TTS/全局组件、导入耗电日志或独立采集性能时，按需读取 [CLI 配置与采集](cli-services.md)。

## 断言卡点与报告判定

设置“是否卡点 / 非卡点超时继续”属于用例编辑，按用户授权修改目标节点；字段是节点 `config.assertBlocking=false`，不是任务参数，不能用 `continueOnError` 替代。只运行已有用例时不修改该设置。
报告中的非卡点未通过、超时或执行异常的节点执行状态为 `success`，必须同时看 `meta.assertion`：`outcome=timeout|error` / `passed=false` / `continued=true` 表示按成功放行继续，不能汇报为断言命中或业务通过。旧runner未加载新源码时不能仅凭config保存成功断言功能可用。

## 按用例执行状态查询

只要失败用例清单时，一次执行：

```bash
"$SOLOPI_DESKTOP_CLI" reports show <taskId> --status failed --limit 20 --json
```

`tasks show` 支持相同参数。这里 `--status` 过滤任务内的用例，支持 `failed|success|running|stopped|pending|all`，可重复或逗号分隔；先过滤再按 `--offset`/`--limit` 分页（默认20，最多50）。新筛选输出在 `task.cases`，整轮 `task.summary` 不随过滤改变；`totalCaseCount` 是整轮数量，`matchedCaseCount` 是匹配数量，`nextOffset=null` 才表示已覆盖全部匹配项。无匹配返回空列表，不代表任务不存在。与 `--case-id` 同用时取交集。

Agent 原生工具等价调用 `read_task_report({taskId,statuses:["failed"],limit:20})`，默认精简清单；不要为15条结果先读整轮报告再全文检索证据。录屏/日志只返回path及可用状态，共享任务日志在 `task.logs` 保留一份，`case.logs[].taskLogIndex` 指向该列表并保留 `startSequence/endSequence`；共享日志路径不代表整份日志都属于该用例。需要具体失败节点/录屏诊断时再用 `read_case_results`，或显式 `read_task_report` 的 `view:"details"`。清单错误可能以 `errorTruncated=true` 标明摘要截断，完整诊断在单用例详情。

已安装旧CLI未升级时先核对真实help，不向旧CLI传未知筛选参数后把全量结果误当作筛选成功。

## 随业务采集性能与独立性能采集

“跑用例并抓性能”使用同一次 `run case/run task --perf glasses|phone|all`，或同一次 Agent `submit_task.performanceOptions`；采集随业务任务结束，无需额外询问独立采集时长，也不另开 `start_performance` 等待任务。平台支持随业务采集，不能因报告为空就断定入口不存在。

Agent 原生参数示例（设备与包名使用本次核验的真实值）：

```json
{"performanceOptions":{"glasses":true,"intervalMs":5000,"targets":{"glasses":{"serial":"<在线SN>","packageName":"<实际应用包名>","runtime":"android"}}}}
```

手机对应 `phone:true` 与 `targets.phone`，可同时开启两端。`enabled:true` 不是合法性能开关，`{}` 不启用采集。提交后核对回执实际 `performanceOptions` 的phone/glass及targets；`performanceAcknowledged=false` 或缺少配置时不能宣称已开启。终态再核查性能报告样本与诊断；任务提交成功、配置被接受都不等于采样成功。缺失历史性能不能靠事后独立采集补回，也不因缺数据自动重跑业务。

只有用户单独要求采集当前应用的一段性能时，才使用 `performance start` / Agent `start_performance`；它不执行业务用例，采集时长属于这一独立任务。设备电池温度不是应用耗电量，耗电报告另用日志导入/分析流程。

查询任务时，summary/details 均返回 `performanceTargets`、`performanceStatus` 和精简 `performanceReports`（有效/失败样本数、报告路径）。有样本时用 `read_performance_report` 按目标分页读取，不因旧任务目标为空推断新任务采集失效。`disabled` 表示本任务未开启，`pending` 表示已配置但尚无样本，二者均不等于采样成功。新提交任务必须重新核对性能回执，前一轮配置不会自动继承；缺参数时不能声称已采集，不可未经授权另开独立任务补采。

## 日志断言清理选项
日志文本、JSON 与 LLM 日志断言沿用步骤参数 `clearBeforeStart`：`false`（默认）匹配当前用例本轮已采集日志，保留前面动作的输出；`true` 仅匹配该断言节点开始后到达的日志。清理只重置读取边界，不删除共享日志文件；每轮仍隔离，不能匹配上一轮。不要将此选项与主动执行 `adb logcat -c` 的用例命令混淆。旧安装版本仍可能强制按最近动作窗口读取，需加载对应修复版本后生效。
