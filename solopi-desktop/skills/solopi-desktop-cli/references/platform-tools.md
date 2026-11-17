# 内置 Agent 与外部 CLI 的统一测试工具

支持此接口的 App/CLI 提供 `tools list/describe/call/result`。它由同一 App Broker 调用内置 Agent 的工具注册表、schema 和执行函数；不调用模型，不创建助手会话，不连接助手的 MCP。用户授权仍由调用方 Agent 管理，目录中的 `write` 标识写操作。

已有 `run task`、`tasks result/watch/stop` 等快捷命令继续可用。分析需要原始报告序号、批量步骤、单例证据视图或批量编辑时使用统一入口；不必为了普通命令先查询整个工具目录。旧安装不支持 `tools` 时升级配套 App/CLI，不通过私有文件写入补齐。

```bash
"$SOLOPI_DESKTOP_CLI" tools list --json
"$SOLOPI_DESKTOP_CLI" tools describe read_case_results --json
"$SOLOPI_DESKTOP_CLI" tools call read_case_results \
  --args '{"taskId":"TASK_ID","caseOrdinal":17,"view":"summary"}' --json
"$SOLOPI_DESKTOP_CLI" tools call read_task_report \
  --args '{"taskId":"TASK_ID","caseIds":["CASE_A","CASE_B"],"view":"steps"}' --json
```

对象结果直接返回并附加 requestId；数组或标量结果保留在 result 中，避免改变数据形状。工具自身的 requestId 如有返回保存在 toolRequestId。参数与原生工具同名同义；不把上述工具名当作新的顶层 CLI 子命令。`read_case_results` 的 `identity` 包含 taskId、caseId、原始 caseOrdinal 和本例日志路径；直接用文件工具、rg/jq/Python 读取这些路径。`configuration` 是执行快照，`sampleLog` 等字段仍只是编辑示例。批量 `steps` 只返回精简执行表，细节按 stepId 再读。

提交也可使用同一接口：

```bash
"$SOLOPI_DESKTOP_CLI" tools call list_cases --args '{"libraryId":"LIBRARY_ID"}' --json
# 将实际返回的 selectionId 写入参数文件，不抄分页 ID 或猜测凭证。
"$SOLOPI_DESKTOP_CLI" tools call submit_task --file submit-arguments.json --json
```

单次保存与范围查询使用 `read_case/query_case_steps/save_case`；受限批量修改使用 `export_cases` → 文件工具修改导出的文件 → `save_cases_from_file`，保留版本及未修改字段。编辑前仍按用户要求的用例规范执行。覆盖检查用 `validate_case_coverage`；证据导出用 `export_case_evidence`。具体参数由 `tools describe NAME` 返回当前 schema，避免根据旧文档臆造。

长参数用 `--file arguments.json`，大结果用 `--out result.json`，路径属于执行 CLI 的目标机器。无需通过 shell 拼接整份 JSON。

每次 `call` 返回 `requestId`（UUID v4）。可显式传 `--request-id UUID` 绑定一次逻辑操作：相同 ID/相同参数回读已保存结果，不重复执行；同 ID 换参数拒绝。只有新的明确操作才使用新 ID。`tools result UUID --json` 仅回读回执，不执行工具；`status=dispatching/unknown` 不表示已成功。超时保留 ackPath，先查原回执或原 taskId，不换新 ID 重提。取消 CLI 会向当前操作发送取消信号；已提交的异步测试用 `stop_task` 或 `tasks stop` 停止。

会话记忆、模型推理、宿主 Shell/文件操作、Skill/MCP 管理不通过此测试工具接口代理；外部 Agent 使用自己的宿主能力。测试能力没有因此减配。
