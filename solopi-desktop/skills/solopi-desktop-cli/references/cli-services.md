# 配置及独立采集（需当前版本 CLI 与 App）


- `config get --json` 查询模型、默认模型、TTS、全局组件，敏感字段返回占位符，不可原样写回。
- `config patch --file patch.json --dry-run --json` 先校验差量；去掉 `--dry-run` 保存。模型/组件通过 id 定位，未指定字段保留；TTS 独立提交。可用 `--api-key-env ENV_NAME` 注入模型凭据，禁止在聊天或日志展示密钥。修改组件定义必须获得用户的全局修改授权。
- `battery import --serial SN --json` 或 `battery import --file /absolute/file.zip --json`（也支持 txt/log），异步返回 id。使用 `battery status ID`、`battery cancel ID`、`battery history`、`battery show REPORT_KEY`，均加 `--json`。采集阶段提示保持设备连接，终态不重复提交；历史结果含保留日志 sourcePath。
- `performance start --serial SN --package org.example.app --role glasses --duration 60 --interval 5 --json` 无需已有用例，采集已运行应用的性能及设备电池温度；支持 `--runtime android|harmony`、`--role phone|glasses`。保存唯一 taskId，用 `performance status/stop/report TASK_ID --json` 或既有 tasks/reports 命令跟踪，仍须核验 UI 同一任务可见。
- 完整字段、参数范围和示例见仓库 `docs/agent/glassbox-cli-usage.md`。旧安装不支持新命令时报告版本差异，不绕过运行时或同步门禁。
