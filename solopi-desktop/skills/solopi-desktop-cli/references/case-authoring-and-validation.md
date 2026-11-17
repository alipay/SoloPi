# 用例编写与校验细节

只在创建、克隆、编辑、修复用例，或分析 validation 错误时读取；业务操作与预期以用户提供的规范为准。仅运行既有用例不得读取。

## 文件批量编辑与提交

批量修改前导出原用例，并按用户指定的修改范围生成补丁。内置 `export_cases` / `save_cases_from_file` 是 Agent 工具；不要拼成 `solopi-desktop export_cases` 等终端命令。

只有 CLI 时，先核对本机 `solopi-desktop cases --help`：`cases show <caseId> --json` 用于读取，`cases update <caseId> --file <case.json> --json` 用于将单条文档经 Broker 保存并同步 UI。可以由一个脚本读取、批量转换和串行提交，不需要每条进入一次模型推理。读取结果应按实际结构提取文档，不将整个查询回执当作 case 保存；保留完整步骤与执行边。

脚本记录每条 caseId、成功回执与未完成项。某条失败即停止后续提交；没有收到回执先用 `cases show` 核对是否已保存，不能直接再次提交。CLI 单条接口不等同于内置 Agent 批量入口的版本校验或全量预检。正式写入前核对源文档是否变化，发现变化重新读取合并，不直接修改运行中的库存储文件。

## 选择修改字段与预检失败恢复

先根据目标组件实际 schema 选择修改方式，再声明 `allowedPaths`；字段范围描述本次改动，不代替用户授权。

| 实际改动 | 文档路径示例 | 保留内容 |
| --- | --- | --- |
| 修改现有节点参数 | `/steps/*/inputs/<参数名>` | `componentId`、组件定义及其余参数 |
| 切换到已有组件 | `/steps/*/componentId`；确有参数变化再列对应 inputs 路径 | 原有 `components[].params`、`helperText`、默认值和顺序 |
| 修改当前用例内的组件定义 | `/components/<已核对索引>/commandTemplate` 等实际目标字段 | 同 ID 全局组件与其他用例；仅在此定义本身属于用户要求时修改 |

按节点/组件 ID 定位，再写入相应字段，不凭旧数组位置猜目标。切换引用不需要把旧组件的参数定义合并到目标组件；只有实际不兼容的节点输入需要适配。不要为统一文案、排序或格式顺带修改组件。

出现 `EDIT_SCOPE_EXCEEDED` 时，检查报出的每条路径。无关改动应还原；已授权目标漏声明了字段时，说明后以正确范围重新 `export_cases`，无需就同一目标重复索要授权。若会改变用户未要求的组件行为或业务范围，先取得对应授权。不要为了通过校验把所有差异加入范围。

预检失败不会自动还原导出文件。保留干净导出副本，或重新导出当前版本，只重放目标补丁；不要在带有上轮多余修改的文件上反复保存，也不要改写范围清单或 `expectedRevision`。核对 `changedFieldsSummary` 后再按需保存；逐例完整字段路径从回执的 `fullResultPath` 按需读取；如果版本冲突，重新读取合并；如果部分成功或回执不明，先按 `saved/remaining` 和实际状态核对，不能整批重放。保存成功只证明持久化，不证明业务执行通过。

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
