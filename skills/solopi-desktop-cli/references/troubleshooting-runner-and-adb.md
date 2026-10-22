# Runner、Broker 与 ADB 排障

## Linux 无桌面执行

使用已部署的同一 CLI；没有有效本机显示会话时，后台 Broker 自动使用包内无显示后端，不启动 Xvfb，也不要求系统 Node/npm。不要把 `xvfb-run` 包在异步提交命令外：提交进程退出会销毁临时显示，而任务仍在后台运行。不要猜 `--no-sandbox`、GPU/Ozone 参数或自行安装工具。运行时不兼容、库状态未绑定或缺系统基础库时，保留一次诊断并交部署维护，不能通过拆分原用例、替换组件、修改原始 state 来修启动环境。

`doctor --json` 的配置就绪与真实执行验证分开。缺状态返回 `WORKFLOW_STATE_UNAVAILABLE`，库内没有目标 ID 返回 `CASE_NOT_FOUND`；两者都不授权创建或改写用例。数据目录通过部署配置或明确的 `SOLOPI_DESKTOP_DATA_DIR` 绑定，不从历史报告路径猜测。

## 提交前设备选择与止损

- 默认 serial 不在线时禁止提交。只有用户已明确选定且当前在线的设备才可通过 `--phone` / `--glasses` 显式传入；unknown 角色不可猜，多设备/角色不明确时询问。不要把现场 SN 固化到 Skill 或用例。
- 提交 ACK 核对实际设备与选择一致，所需包名未因显式 SN 丢失；不一致或必需值为空时正常 stop 并报告，禁止重提纠正。
- 首次出现 device not found/offline/unauthorized/transport 错误，正常停止同一任务并回读终态；不自动重连或重跑。普通业务断言失败仍按压测规则继续；单独 stayon 失败不按设备离线处理。

只在提交 ACK、runner、stop、沙箱、设备或 ADB 异常时读取。

## Broker 与 taskId

`run case`/`run task` 使用同一安装的单实例 Broker。保存候选 `taskId`，先 `tasks show` 确认是否已提交；ACK 超时不得直接重提。`tasks show` 的存活状态为 `alive/dead/unknown`，只有 `dead` 才是 `TASK_STALE_RUNNING`；`unknown` 不得强制停止。

停止优先：

```bash
"$SOLOPI_DESKTOP_CLI" tasks stop <taskId> --json
```

## Codex 沙箱

涉及本地 runner、ADB、scrcpy 或 localhost 的命令可能需要获批环境。必须先确认没有 taskId，再执行一次；禁止沙箱内外各提交一遍。

## 设备前置

使用 `devices list --json` 的权威 serial/adbPath，不用 `adb devices` 猜：

```bash
"<adbPath>" -s "<serial>" get-state
"<adbPath>" -s "<serial>" shell true
"<adbPath>" -s "<serial>" shell pidof <package>
```

`offline`、`unauthorized`、transport 或包缺失立即停止，并提示用户检查连接/授权。`pidof` exit 1 + 空 stdout 是“未运行”，不是传输失败。单独 `svc power stayon` exit 137 是结构化 warning，不应独自 fail-fast。

不要把 `adb start-server`/`kill-server` 放进每次运行；只在 daemon 明确不可达时恢复一次。

## 长任务与幽灵 runner

图片 Mock 排障时核对用例配置的源文件、目标路径、目标应用权限及应用回执。ADB 传输成功不等于业务加载成功；业务加载条件由使用者的脚本和断言提供。证据不足时保留原始日志，不自动换包、改权限或重复压测。

默认异步，不用 `--wait`。权威状态来自 `tasks show`/`reports show`，不从日志关键词推断。只有旧版本确实没有 taskId/控制记录时，才检查残留进程和 runDir。

## 任务日志规则

任务每台设备保持单一持续日志流，报告与断言共享，按轮次/动作序列范围读取；不依赖标记收发放行。日志证据故障只使依赖断言失败，不应终止整场压测，也不得把不完整证据判成功。序列范围不能排除迟到旧响应。业务匹配只由用例既有的正则、JSON 路径和变量表达；平台不得内置业务字段名、默认业务解析规则或专用关联配置。
