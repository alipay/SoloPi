# 并行断言与最新状态汇合

这是用例图的能力，没有新增 CLI 子命令或运行开关。需要支持隐式并行的客户端/执行器；旧安装包必须先更新，不能只更新 Skill。

## 连线与配置

收音就绪等待只用于衔接后续的新语句输入。沿实际 `edges` 检查当前分支：若业务断言后直接结束、退出或仅剩清理步骤，保留业务断言，不再并行等待 `VOICE_LISTENING`；只有后续还要发送新语句时才保留该等待。不能按 `steps[]` 顺序或节点名称推断。业务已退出的合法终态先校验业务结果并结束，不要求恢复收音。

```text
上一动作 ┬→ 原页面/业务断言（命中后保留）─┐
         └→ 已有日志文本断言（latest）───┤→ 后续节点（只执行一次）
```

使用已有组件快照；日志文本断言的有效 `kind` 为 `tts_assert`。例如以下步骤引用已有 `component-tts-text-assert`，不创建新组件定义：

```json
{
  "id": "ready",
  "name": "持续检查最新收音状态",
  "type": "component",
  "componentId": "component-tts-text-assert",
  "device": "glasses",
  "config": {"assertBlocking": true, "observationMode": "latest"},
  "inputs": {
    "extractRegex": "ExampleStateMachine.*transitionTo \\S+ -> (\\w+)",
    "expectedText": "VOICE_LISTENING",
    "matchOperator": "equals",
    "caseSensitive": "true",
    "clearBeforeStart": "false",
    "captureScreenshotOnPass": "false",
    "extractVariableEnabled": "false",
    "extractVariableName": ""
  },
  "timeoutMs": 45000,
  "postDelayMs": 0
}
```

这是用例级业务示例，框架没有默认 tag、状态或设备。正则应捕获所有目标状态，不能只匹配 `VOICE_LISTENING`，否则无法观察回退。`expectedText`、比较方式、大小写和提取正则沿用已有组件能力。

设上一动作为 `audio`，原断言为 `page`，后续为 `next`，完整的局部 `edges` 为：

```json
[
  {"id":"audio-page","source":"audio","target":"page"},
  {"id":"audio-ready","source":"audio","target":"ready"},
  {"id":"page-next","source":"page","target":"next"},
  {"id":"ready-next","source":"ready","target":"next"}
]
```

保留用例其他节点和连线，不把此局部片段替换成整条用例。真实执行顺序以 `edges` 为准。

- 普通节点的多条无条件（或 default）出线形成并行组；不添加 `parallel`、`join`、`log_state` 节点。
- 每路当前支持一个已有只读断言（`tts_assert/json_assert/llm_assert/mobile_ui_assert`），每路直接连接同一个后续节点；分支不能额外接入其他起点，共同后继只能接收本组分支。IF 的 true/false/error 仍是选择分支。
- 各断言保持卡点：`config.assertBlocking` 不能为 false，不能用 `continueOnError` 放过失败。`latest` 仅用于 `tts_assert`，执行后延时为0，不能单独放在串行链。
- `observationMode` 省略或为 `latched` 时命中一次保留；`latest` 始终检查最新捕获值。页面先通过或状态先就绪都可；状态就绪后回退时继续等待，直到原断言通过且最新值也满足，才执行共同后继。
- 监听先注册，复用已有日志流。各分支有效 clearBeforeStart=false 回读当前用例已有日志（包括更早动作），true 只等待本分支开始后的新日志；状态监听未配置且组件无默认值时沿用最近动作窗口。组件默认值可由步骤覆盖，并行不改写此语义。latest 取范围内序列最新的值，旧就绪不能覆盖后来的回退；不跨 case。
- 回读本例较早日志不证明它是最近音频的新响应；需判断最新输入时，按用例需求设置读取边界及通用匹配条件。未知状态不放行；组总上限取分支完整预算最大值；LLM按日志等待+各候选/重试的独立模型预算+有界间隔及收尾预算相加，不能把日志20秒当成总上限。单次模型请求仍独立15秒（沿用配置），请求/候选次数有上限，完成立即汇合；明细保留在报告。失败、超时或停止不执行后继。

## CLI 读取、保存和复核

```bash
"$SOLOPI_DESKTOP_CLI" cases show CASE_ID --json > before.json
# 在本地从完整读取结果生成 case.json；保留原步骤、组件快照、素材和其他字段。
"$SOLOPI_DESKTOP_CLI" cases update CASE_ID --file case.json --json
"$SOLOPI_DESKTOP_CLI" cases show CASE_ID --json > after.json
```

读取结果包含 `case`、`edges`、`components`、`nodePositions`；按该结构编辑。`steps/edges` 数组整体替换，不能只提交新增步骤或上述四条边。核对保存 `success`，回读原节点及新增配置；`uiUpdated` 表示运行中页面同步回执。结果未知时先读实际状态，不盲目重提。直接编辑运行中App状态文件不受支持。

只有生成独立文件、离线检查或调试结构时用 `cases validate case.json --json`。用户授权执行时直接 `run case CASE_ID --json`（多例使用 `run task`）；不增加逐例预校验步骤，也不把保存授权当成设备执行授权。无效并行结构返回 `PARALLEL_CONFIGURATION_INVALID`，按错误检查共同后继、断言类型和卡点设置。

画布有效组显示“并行 N 路”和 `&&`；不完整连线显示红色警告。标识表示配置关系，不表示运行已通过。离线回放应覆盖页面先到、状态先到以及就绪后回退恢复；保存和静态校验不能替代真实业务验收。
