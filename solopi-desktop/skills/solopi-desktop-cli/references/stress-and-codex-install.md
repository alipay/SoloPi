## 压测（CLI 支持压测参数的版本）

先检查安装客户端的 `run task --help` 是否包含 `--stress-rounds`。旧版本没有此参数时明确提示升级，不得把一次普通执行当成压测，也不要用 shell 循环创建多个任务。

```bash
"$SOLOPI_DESKTOP_CLI" run task --case-id <caseId> --stress-rounds 100 --json
"$SOLOPI_DESKTOP_CLI" run task --case-id <caseIdA> --case-id <caseIdB> --stress-minutes 30 --stress-logs all --json
```

- 轮数与分钟数互斥，必须为 1–100000 的整数；用户未给压测次数或时长时先询问，不擅自无限运行。
- 一轮按顺序执行全部选中用例；某条失败仍会继续后续用例和轮次。每轮隔离运行变量。
- 时长模式到时不启动下一条，当前用例执行完后结束，因此实际耗时可超过设定时长。
- `--stress-logs phone|glasses|all|none` 控制任务级连续日志，默认 glasses。选择日志设备必须已连接；纯电脑压测使用 none。录屏默认关闭，仅按用户要求启用。
- 提交一次保存唯一 taskId；用 `tasks show` 查看 `stress`、`currentRound`、进度及逐轮结果，用 `tasks watch` 追踪事件，`tasks stop` 提前停止。不要使用 `--wait` 等待长压测。
- 普通用例执行与压测均依赖用户自己的设备、用例库及外部命令；QWC 等工具不随 solopi-desktop 提供。

## 安装到 Codex

安装包内包含此 Skill。首次接入可用已安装 App 的 CLI 注册：

```bash
"$SOLOPI_DESKTOP_CLI" skills install codex --json
# 已安装此 Skill 时，经用户要求更新可替换该 Skill 目录：
"$SOLOPI_DESKTOP_CLI" skills install codex --force --json
```

默认写入 `~/.codex/skills/solopi-desktop-cli`，设置 CODEX_HOME 时写入其 skills 目录；命令返回实际路径。之后新建 Codex 会话；未发现时重启 Codex。更新仅替换 solopi-desktop-cli，不安装其他技能，也不改 Codex 权限。
