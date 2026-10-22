# 录屏、性能与报告

只在用户要求录屏/perf、终态报告缺失或报告索引异常时读取。

## 任务参数

```bash
--record-glasses-screen
--record-phone-screen
--show-glasses-screen
--perf phone|glasses|all
--perf-interval-ms 2000
```

默认不启用手机录屏。性能目标需要对应 serial 和 package；默认使用本次任务 ACK 的实际设备配置包名，取不到时才使用用例默认值。`--perf-phone-package` / `--perf-glasses-package` 显式覆盖优先，不修改用例或全局设备配置。`--perf-phone`、`--perf-glasses`、重复或逗号分隔的 `--perf` 均参与设备选择。缺少目标值时返回 `PERFORMANCE_TARGET_CONFIG_MISSING`、`submitted:false`、`taskId:null`，不切换环境、不提交任务；先修正配置再提交。

## 报告

0.1.120 安装包在日志边界基础设施故障时会停止后续轮次；2026-09-23 后续源码已取消此策略（尚未打包），边界错误只影响本轮校验，后续轮次继续。先看 diagnostics 中设备 SN、标记和发送/接收阶段，不自动重提任务或认定设备离线。Android 性能样本的 commandErrors 保留失败命令和原始诊断；PERFORMANCE_COMMAND_FAILED 与 PERFORMANCE_PROCESS_ID_UNRESOLVED 不能解释为进程不存在，部分读数不代表完整采样成功。

终态 `success/failed/stopped` 自动生成 `.glassreport`。返回：

- `reportPackage.path`
- `artifacts.runDir`
- devices
- performanceOptions/performanceReports
- 首个失败节点与结构化错误

查询：

```bash
"$SOLOPI_DESKTOP_CLI" reports show <taskId> --json
"$SOLOPI_DESKTOP_CLI" reports list --json
```

终态任务缺报告索引时先运行 `reports reindex --dry-run --json`；只有明确修复本地索引时才执行非 dry-run。

有效录屏必须存在且非零字节。任务终止后不应遗留新的 scrcpy 进程。


## 可选 ART 线程栈

自动化任务运行期启用 `--thread-stacks --perf phone|glasses|all`，默认关闭，有暂停应用的开销。模式 `--stack-mode manual|interval|checkpoint|failure`；默认手动。最小间隔 `--stack-interval-ms 60000`（不能低于 30000），最多批次 `--stack-max-count 10`，总字节 `--stack-max-bytes 16777216`。检查点用可重复的 `--stack-checkpoint <stepId>`，在指定节点执行前采集，可选清理节点作为检查点。失败模式在用例终态清理前采集；若业务命令已退出进程则明确失败，不能补采过去的栈。

手动命令：`solopi-desktop tasks capture-stacks <taskId> --json`，仅运行中且已启用的任务可用；不会另起业务任务。`reports show <taskId> --json` 查看 threadStacks，原始文件随 `.glassreport` 导出。信号成功不代表 trace 成功；权限不足、身份不明、无新完整文件、超时等均保留诊断，不提权或清理用户 ANR。

这是线程栈位置快照，不能作为线程 CPU 时长或等待时长。CPU 百分比注明 top/dumpsys 来源和单核口径，不能与四核系统占用直接比较。未提供逐线程累计 CPU 统计。

### 长任务性能证据与轮次口径

性能样本的完整命令输出可能存放在 `rawEvidencePath`，指标 JSON 不再内嵌所有原始输出；诊断失败时按需读取该证据，不能因 `raw` 缺失认定没有采集。报告包会携带证据，包内相对路径以解包根目录解析。样本用 `sampleId` 去重，整场统计读取任务样本，禁止把各轮样本数直接相加。本轮按 `[startedAt, endedAt)` 归属，轮间样本可能只属于整场；以 `caseId`、`attribution`、`sampleScope` 为准。`runtimeDiagnostics` 提供事件循环延迟及写盘耗时，不能单凭超时判断设备故障。

Android 性能采集（0.1.126 源码）随 `--perf` / UI 性能选项采集设备电池温度，样本字段 `batteryTemperatureC`，任务性能报告含均值、峰值、趋势与明细。缺失值不能按 0 处理；它不是应用耗电量。旧独立耗电分析已删除，无拔线统计。需更新安装包后生效。

## 随业务采集性能与独立性能采集

“跑用例并抓性能”使用同一次 `run case/run task --perf glasses|phone|all`，或同一次 Agent `submit_task.performanceOptions`；采集随业务任务结束，无需额外询问独立采集时长，也不另开 `start_performance` 等待任务。平台支持随业务采集，不能因报告为空就断定入口不存在。

Agent 原生参数示例（设备与包名使用本次核验的真实值）：

```json
{"performanceOptions":{"glasses":true,"intervalMs":5000,"targets":{"glasses":{"serial":"<在线SN>","packageName":"<实际应用包名>","runtime":"android"}}}}
```

手机对应 `phone:true` 与 `targets.phone`，可同时开启两端。`enabled:true` 不是合法性能开关，`{}` 不启用采集。提交后核对回执实际 `performanceOptions` 的 phone/glasses 及 targets；`performanceAcknowledged=false` 或缺少配置时不能宣称已开启。终态再核查性能报告样本与诊断；任务提交成功、配置被接受都不等于采样成功。缺失历史性能不能靠事后独立采集补回，也不因缺数据自动重跑业务。

只有用户单独要求采集当前应用的一段性能时，才使用 `performance start` / Agent `start_performance`；它不执行业务用例，采集时长属于这一独立任务。设备电池温度不是应用耗电量，耗电报告另用日志导入/分析流程。
