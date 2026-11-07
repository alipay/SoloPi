# 运行中增量发现失败

## 运行中增量发现失败

用户要求边跑边分析或发现问题立即提单时，异步提交唯一任务后立即进入增量监控。提单平台、团队规则和授权由用户提供，本 Skill 不内置这些配置。

优先检查当前安装的 `--help` 是否提供事件流命令。支持时使用：

```bash
"$SOLOPI_DESKTOP_CLI" tasks watch <taskId> --jsonl --after <taskRevision>
```

只消费 `case_terminal` / `case_artifacts_ready` / `task_terminal`，保存最后一个 revision 以便断线续接。不得因监听重连而重复提交任务。

当前安装尚未提供 `tasks watch` 时，回退为周期性执行：

```bash
"$SOLOPI_DESKTOP_CLI" tasks show <taskId> --json
```

回退轮询必须遵循：

- 按 `(taskId, caseId, endedAt)` 去重，只把 `task.cases[]` 中 `status=failed`、存在 `endedAt` 且日志/录屏已经落盘的 case 交给分析流程。
- 不得只根据任务级 `status=failed` 判断整个任务结束；还要确认 `finishedAt` 存在且 `completed >= total`，或收到 `task_terminal`。
- 原任务仍运行时禁止自动重跑失败 case、停止任务或抢占同一设备。证据不足时把该 case 标记为待补证，不得猜测根因或误提业务 Bug。
- 完整 `.glassreport` 仍在任务终态后读取；增量提单使用已经封口的单 case 日志与录屏，终态后再追加任务汇总和报告证据。
- 每个失败 case 只绑定自己的录屏和日志 artifact。禁止用同任务上一条/代表 case 录屏替代，禁止把“任务报告内证据”当成已上传日志；artifact 缺失时交由分析流程 按缺证策略处理。
- 监控持续到权威 `task_terminal`；发现新失败立即回执，不等待全部用例完成。

失败分类、查重、证据上传和同根因合并遵循用户配置的缺陷工作流；未配置时输出本地报告与证据路径，不猜测目标平台。

提交/ACK、停止、沙箱、ADB 或 runner 异常时才读取
[`references/troubleshooting-runner-and-adb.md`](troubleshooting-runner-and-adb.md)。

