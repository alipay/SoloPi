# SoloPi AI 验证工程

本层位于需求/Agent 与 SoloPi 执行能力之间。它负责把结构化需求和 AC
编译成可重复计划。验证引擎中的 Result Judge 独占最终判定权；Android 端仍只
执行固定用例和动态 Agent typed action，Agent 和模型都不能直接宣布业务通过。

## 输入契约

需求文件使用 `solopi.ai.requirement/v1`，至少包含：

- `id`、`title`、`targetAppPackage`；
- 非空 `acceptanceCriteria` 和 `scenarios`；
- 每个场景的 AC 映射、步骤、checkpoint；
- 可选 `dependsOn`、`bindings`、`testData`、`preconditions`、`cleanup` 和
  `budget`；
- 可选 `reusableFlows`，通过 `{"use":"flow-id","bindings":{...}}` 展开。

参数用 `${name}` 绑定。整个字符串只有一个占位符时保留原 JSON 类型；嵌入
文本时仅接受标量。未定义、循环或复合文本绑定在编译期失败。

步骤只有两类：

```json
{"id":"tap-submit","type":"operation","action":{"type":"click","selector":{"resourceId":"com.example:id/submit"}}}
{"id":"explore-result","type":"explore","goal":"找到结果","allowedActions":["click","wait"],"budget":{"maxSteps":5,"maxDurationMs":60000}}
```

`operation` 是已知稳定步骤，必须带真实 selector，并编译为 SoloPi 固定用例。
`explore` 是未知工作，必须有目标、typed action 白名单和设备端预算；不能用
`explore` 包装已经稳定的动作。两者相邻时按连续区间生成 segment。

## Result Judge、Oracle 与三态结果

checkpoint 绑定准确 `afterStep`、一个或多个 AC，以及确定性 UI Oracle。这里的
Oracle 是一组“从哪个 selector 读取哪个字段、如何与 expected 比较”的预期规则，
不是 Oracle 数据库，也不是 Agent、模型或 Worker 的自评结果：

```json
{
  "id":"value-is-one",
  "afterStep":"tap-increment",
  "acceptanceCriteria":["AC-1"],
  "oracle":{
    "type":"ui",
    "selector":{"resourceId":"com.example.counter:id/counter_value"},
    "field":"text",
    "operator":"equals",
    "expected":"1"
  }
}
```

当前 Oracle 只支持 `text`/`description` 与 `equals`、`contains`、`matches`。
固定段把 Oracle 编译为有稳定 `stepId` 的 `ASSERT`；动态段在 `done` 后对
settled observation 执行同一确定性规则。`model` Oracle 被静态拒绝。Result Judge
汇总 checkpoint、依赖、前置条件、执行证据和 required cleanup 后，才产生唯一
最终三态：

- `passed`：所有 checkpoint 有证据且 Oracle 通过，所需清理也通过；
- `failed`：Oracle 确认不匹配，或 required cleanup 失败；
- `not_tested`：依赖/前置条件未通过、checkpoint 未到达、证据缺失或失败无法
  归因到准确 Oracle。

`not_tested` 表示没有足够且可归因的证据形成通过/失败结论，不是笼统的“Oracle
失败”。Agent 的 `done` 只停止探索。它不改变三态，也不能跳过 checkpoint。

## 编译与校验

```bash
scripts/solopi-ai --pretty verify-normalize \
  --file requirements/counter.json --output artifacts/counter.normalized.json
scripts/solopi-ai --pretty verify-compile \
  --file requirements/counter.json \
  --output artifacts/counter.plan.json \
  --cases-dir artifacts/counter-cases
scripts/solopi-ai --pretty verify-validate --plan artifacts/counter.plan.json
```

编译输出包含 Goal Tree、`solopi.ai.test-intent/v1`、场景 DAG、路由、固定用例
和 `planFingerprint`。JSON 对象键顺序不影响指纹。校验器会拒绝依赖环、缺失
AC/checkpoint、悬空步骤、未解析参数、路由矛盾、无预算探索、动态清理、模型
Oracle、非法固定动作和指纹不匹配。

## 执行与 Agent 决策

`deterministic` 仅运行编译后的固定用例，`dynamic` 仅运行 Agent segment，
两者都有时场景为 `hybrid`。固定段复用现有 `case-import`/`run`；动态段复用
`agent-session-start`/`agent-act`/`agent-timeline`/`agent-end|cancel`。

模型或控制器可通过兼容的本地决策文件接入；端侧部署完成后也可使用同一
DecisionProvider 契约实时接入。DecisionProvider 在动态 segment 的首帧
observation 到达后调用，并在每个成功动作返回新的 settled observation 后再次
调用；它只输出 Action Proposal，不持有设备租约、不调用设备动作，也不参与
Result Judge 的最终裁决：

```json
{
  "scenario-id": {
    "explore-step-id": [
      {"type":"act","stepId":"step-001","action":{"type":"click","selector":{"resourceId":"com.example:id/submit"}}},
      {"type":"done","reason":"goal reached"}
    ]
  }
}
```

决策只允许 `act`、`done`、`blocked`。`act` 仍受编译白名单和第一阶段七种
typed action 约束；selector 必须在当前 observation 唯一命中，随后转换为该
帧 `nodeId`。不能携带 Shell、枚举、Provider、Scheme 或未知字段。

不要把 DecisionProvider 与 Android 回放动作扩展混为一谈：动作目录中的 6 个
动态 ActionProvider 动作由三个 Android `ActionProvider` 实现发布，用于性能、
录屏和图片操作；DecisionProvider 是验证控制层的下一步提议接口，输出仍只能
落到七种动态 typed action，而不能直接调用这 6 个回放 Provider 动作。

```bash
scripts/solopi-ai --pretty verify-run \
  --plan artifacts/counter.plan.json \
  --agent-decisions requirements/counter-decisions.json \
  --artifacts artifacts/counter-run-001
```

实时端侧执行使用 `--decision-provider on-device --model-package <签名包>`；cloud
使用 `--decision-provider cloud --cloud-endpoint <url>`。两者产出的 Action Proposal
经过完全相同的白名单、observationId、receipt、settle、timeline 和 Result Judge
路径。详见
[端侧 Agent 模型部署](model-deployment.md)。

证据目录必须不存在。输出包含只追加 `events.jsonl`、计划副本、每个固定段的
用例/导入/回放证据、每个动态段的脱敏 transcript/timeline，以及统一
`report.json`。`ownerToken` 不写入证据。

报告中每个 checkpoint 保留 `oracle`、`status`、`reason` 和
`evidenceRefs`；场景保留依赖、precondition、segment、cleanup 和失败类别。
每个结论必须能沿同一次运行反向定位：`planFingerprint -> task/shard/attempt
（托管时） -> sessionId/observationId/stepId -> typed receipt -> settled
observation -> timeline -> checkpoint/cleanup -> Result Judge -> report/evidence
digest`。不得用另一轮重试、另一 Worker 或独立性能会话的证据补齐本次结果。

`outcomeFingerprint` 排除时间、run ID 和路径，只对计划指纹、最终状态、场景、
checkpoint reason/status 与 cleanup 状态做规范化摘要，用于比较裁决结果是否一致。
它不包含完整证据内容或来源标识，不能替代 same-run evidence chain，也不能单凭
指纹证明两份报告来自同一次执行；跨环境复现还必须显式核对设备和环境条件。

## Demo 夹具

- `solopi-harness-cli/fixtures/verification/counter-success.json`：可重复固定成功；
- `counter-outcome-matrix.json`：hybrid 成功、产品失败、Agent 误报完成、未覆盖
  checkpoint 和清理失败；
- `counter-agent-decisions.json`：只包含 typed act/done/blocked。

这些 selector 来自 SoloPiTddDemo 既有用例，不修改 Demo App。设备池、模型
部署、端侧推理和训练闭环均不属于本层。
