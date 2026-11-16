# 用例编写与校验细节

只在创建、克隆、编辑、修复用例，或分析 validation 错误时读取；业务操作与预期以用户提供的规范为准。仅运行既有用例不得读取。

## 文件批量编辑与提交

批量修改前导出原用例，并按用户指定的修改范围生成补丁。内置 `export_cases` / `save_cases_from_file` 是 Agent 工具；不要拼成 `solopi-desktop export_cases` 等终端命令。

只有 CLI 时，先核对本机 `solopi-desktop cases --help`：`cases show <caseId> --json` 用于读取，`cases update <caseId> --file <case.json> --json` 用于将单条文档经 Broker 保存并同步 UI。可以由一个脚本读取、批量转换和串行提交，不需要每条进入一次模型推理。读取结果应按实际结构提取文档，不将整个查询回执当作 case 保存；保留完整步骤与执行边。

脚本记录每条 caseId、成功回执与未完成项。某条失败即停止后续提交；没有收到回执先用 `cases show` 核对是否已保存，不能直接再次提交。CLI 单条接口不等同于内置 Agent 批量入口的版本校验或全量预检。正式写入前核对源文档是否变化，发现变化重新读取合并，不直接修改运行中的库存储文件。

## 解析一致性

CLI/UI 组件合并：

```text
builtinComponents + state.components + bundle.components + case.components
```

`caseEdges[caseId]` 是 canonical 执行图；`case.edges` 仅兼容。保留 React Flow `targetHandle`，分支只读取 `sourceHandle/handle/condition`。缺 endpoint 返回 `CASE_EDGE_ENDPOINT_MISSING` 且零 task/runner/device。

IF 分支只用 `true/false/error`。ADB 节点可配置 `acceptedExitCodes`、`onError=fail|continue|branch` 和安全 outputMapping（trim/notEmpty/equals/regex/json/jsonPath），禁止任意 JS。

## 资产

静态相对音频/图片路径以输入 case/bundle 所在目录为基准；真实缺失应在提交前报错。`${...}`/`{{...}}` 动态路径跳过静态存在检查，运行时解析后再校验。

默认音频 Mock 使用硬编码 `ACTION_SEND_AUDIO`。图片 Mock 使用 `template-image-mock`：push 到 glasses、广播由 phone 执行、路径位于眼镜应用 files 目录。

## HTTP、TTS 与断言

HTTP 非 2xx、明确业务错误或必需 JSONPath 缺失必须 fail-fast。TTS 先识别业务失败，再提取 URL；输出保留脱敏原始响应。

新 `tts_assert/json_assert/llm_assert` 默认关闭变量提取。开启时名称非空且跨断言类型唯一，否则 validation 零提交。

## 图完整性

图模式必须合法到达 End；提前断路为 `WORKFLOW_PATH_TERMINATED_EARLY`，环/重复为 `WORKFLOW_CYCLE_DETECTED`。报告保留 planned/executed path、reachedEnd、terminationReason、failedEdge、duplicateStepId。


断言卡点策略保存为目标节点的 `config.assertBlocking`（boolean，默认true），四类断言统一支持。false使该断言未通过、超时或执行异常均按节点成功继续且不影响任务成败（用户停止除外）；与 `continueOnError` 语义不同。修改时只更新已授权的目标用例，不要修改全局组件或任务参数。
