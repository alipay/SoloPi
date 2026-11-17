# 配置及独立采集（需当前版本 CLI 与 App）


- `config get --json` 查询模型、默认模型、TTS、全局组件，敏感字段返回占位符，不可原样写回。
- `config patch --file patch.json --dry-run --json` 先校验差量；去掉 `--dry-run` 保存。模型/组件通过 id 定位，未指定字段保留；TTS 独立提交。可用 `--api-key-env ENV_NAME` 注入模型凭据，禁止在聊天或日志展示密钥。修改组件定义必须获得用户的全局修改授权。
- `battery import --serial SN --json` 或 `battery import --file /absolute/file.zip --json`（也支持 txt/log），异步返回 id。使用 `battery status ID`、`battery cancel ID`、`battery history`、`battery show REPORT_KEY`，均加 `--json`。采集阶段提示保持设备连接，终态不重复提交；历史结果含保留日志 sourcePath。
- `performance start --serial SN --package org.example.app --role glasses --duration 60 --interval 5 --json` 无需已有用例，采集已运行应用的性能及设备电池温度；支持 `--runtime android|harmony`、`--role phone|glasses`。保存唯一 taskId，用 `performance status/stop/report TASK_ID --json` 或既有 tasks/reports 命令跟踪，仍须核验 UI 同一任务可见。
- 完整字段、参数范围和示例见仓库 `docs/agent/glassbox-cli-usage.md`。旧安装不支持新命令时报告版本差异，不绕过运行时或同步门禁。


## Agent 模型后端

模型设置提供 API/本地运行时两个 Tab。`config runtime --action get|discover|models|test --runtime <discover返回的运行时ID> --model <实际模型名> --json` 复用当前宿主配置接口；`--file` 接受 `{ "action":"save", "selection":{ "mode":"local-runtime", "runtimeId":"codex", "model":"实际模型名" } }`，切回API使用 `{ "action":"save", "selection":{ "mode":"api" } }`。默认提供 Codex 与 Claude Code，其他兼容命令由宿主 runtime-definitions.json 配置。先探测目录并测试连接，再保存；检测程序不代表已登录，模型列表不代表有额度。不得读取/输出密钥文件代替登录。Server 网站同能力属于Server宿主，不是浏览器电脑。正在执行的回合保留原后端，新回合使用已保存配置；不因切换创建测试任务或重复原操作。
