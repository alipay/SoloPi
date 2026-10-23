# FastPath 独立页面评测

`evaluate_dataset.py` 只读取本地冻结数据，调用现有 FastPath 候选约束和可选的本地 Laya。它不连接手机，不点击任何节点，也不把离线选对称为业务通过。

## 运行

在仓库根目录，准备一个清单目录。该目录中的原始截图、页面树可能含账户信息，保留在本地。输出摘要不会复制目标文案、节点 ID、路径或原始页面，但发布前仍须检查自己命名的样本 ID 和标签。

```bash
python3 solopi-skill/scripts/harness/examples/fastpath/evaluate_dataset.py \
  --manifest /absolute/path/to/dataset/manifest.json \
  --split test \
  --output /absolute/path/to/new-rules-report.json
```

同时对比 Laya 时，用安装了 `laya-mlx` 的 Python 执行同一命令，增加 `--model /absolute/path/to/existing/local/model`。模型只加载一次；评测器不下载权重。输出文件必须不存在，父目录必须已存在。规则映射、候选策略、概率阈值、问题指令都应在第一次测试推理前冻结。

程序接口：

```python
from pathlib import Path
from solopi_harness.fastpath_evaluation import evaluate_dataset

report = evaluate_dataset(Path("/absolute/path/to/dataset/manifest.json"),
                          predictor=local_predictor, split="test",
                          model_version="checkpoint-sha256")
```

注入的 predictor 接收现有 Laya request，只含 `model`、`state` 和 `questions`，不接收正确标签、样本编号、分组、基线配置或验收结果。调用方仍有责任避免把测试结果用于调参，再将同一数据声称为未见测试集。

## 清单与隔离

清单版本为 `solopi.ai.fastpath-dataset/v1`。引用文件必须位于清单目录内，使用相对路径及文件原始字节的 SHA-256；禁止越界路径和指向目录外的符号链接。所有 split 的引用都通过摘要校验后，才开始推理。SHA 证明文件未变，不证明数据是谁采集的。

```json
{
  "schemaVersion": "solopi.ai.fastpath-dataset/v1",
  "datasetId": "example-heldout",
  "frozenAt": "2026-09-27T12:00:00Z",
  "ruleConfig": {"path": "rules.json", "sha256": "<64 lowercase hex characters>"},
  "policies": {
    "open-service": {
      "path": "policy.json",
      "sha256": "<64 lowercase hex characters>",
      "provenance": {"kind": "predeclared", "reference": "Frozen candidate allowlist from the test specification"}
    }
  },
  "groups": [
    {
      "id": "services-layout-a",
      "split": "test",
      "sourcePageId": "services-capture-a",
      "layoutFamilyId": "services-grid",
      "provenance": {
        "kind": "real_capture",
        "capturedAt": "2026-09-27T11:00:00Z",
        "source": {"path": "private/capture.json", "sha256": "<64 lowercase hex characters>"}
      }
    }
  ],
  "cases": [
    {
      "id": "services-open-delivery",
      "groupId": "services-layout-a",
      "policyId": "open-service",
      "context": {"path": "private/context.json", "sha256": "<64 lowercase hex characters>"},
      "expected": {"outcome": "act", "nodeIds": ["the-actual-clickable-target-node-id"]},
      "tags": ["similar_entry"]
    }
  ]
}
```

上例是格式说明，不是已运行的数据或手机证据。`context.json` 使用现有 `{stepId, goal, allowedActions, observation}` 格式；`policy.json` 使用现有 `solopi.ai.fastpath-policy/v1`，可配置 `candidateResolution: self-or-clickable-ancestor`。正确标签写实际可点击目标 ID，而不是不可点击的文字子节点。

分组要求：

- `sourcePageId` 或 `layoutFamilyId` 相同的样本必须在同一个 `train`、`dev` 或 `test`。同页不同说法不是独立页面。
- 相同源文件摘要或完全相同的观察树，不能改个分组名后跨 split。不同观察 ID 不会让相同页面树变成独立页面。更广泛的近重复页面仍须人工审查。
- 真机采集标为 `real_capture`，保留源文件摘要。该字段是数据作者的来源声明，程序不验证实际手机采集过程，也不验证原始文件到 context 的提取过程。
- 人工改文案、禁用节点、打乱布局标为 `derived`，provenance 必须提供 `parentGroupId`、`transformation`；派生组与父组保持相同 sourcePageId、layoutFamilyId 和 split。不能把派生样本称为真实页面变化。
- 纯合成单测标为 `synthetic`，provenance 必须提供 `description`。本模块单元测试全部为合成 fixture。
- `expected` 为 `{"outcome":"refuse","nodeIds":[]}` 时，模型点击任何候选都算错误动作；模型说 `done` 不算正确拒答。正例拒答单列，不混入错误动作率。

## 公平基线

规则配置版本为 `solopi.ai.fastpath-evaluation-rules/v1`，例如：

```json
{
  "schemaVersion": "solopi.ai.fastpath-evaluation-rules/v1",
  "mappings": [
    {
      "goal": "打开物流服务",
      "resourceSelector": {"resourceId": "com.example:id/delivery"},
      "exactText": "物流服务",
      "provenance": {"kind": "predeclared", "reference": "Frozen application navigation specification"}
    }
  ]
}
```

每条映射至少含 `resourceSelector` 或 `exactText`。稳定 ID 基线可以附带 `packageName`、`className`、`text`、`description`、`contentDescription` 来消除重复 resourceId；其 `resourceId` 必填。父节点解析模式中，规则可以匹配候选的来源子节点或实际可点击祖先；同一动作只计一次匹配。这样不会因为稳定 ID 位于父容器而人为削弱规则。动作仍指向当前观察中的合法祖先。文字基线精确匹配同一候选的展示标签。两者都不绕过包名、可见性、可用性、唯一性等约束，也不会从 expected 自动生成映射。

可以用 `{"kind":"development","caseIds":["a-dev-case"]}` 声明配置来自 train/dev 样本；引用 test 样本会拒绝加载。`predeclared` 表示从预置业务规格人工配置，程序不能证明配置冻结时间。合理覆盖已知正例表达，不能故意漏配规则以夸大模型收益。未知 goal 单独标记 `goal_not_configured`，不能当成规则理解了“不支持”的语义。

同一候选池有利于比较决策，但不代表穷尽了规则能力：若候选策略本身依赖易变文案，稳定 ID 基线也会受其限制。应优先使用冻结的稳定候选范围，单独报告候选覆盖率。

## 指标解释

结果同时给出样本数、分组数、源页面数、布局家族数、真实/派生/合成数量，并按 `tags` 细分。建议标签包括 `similar_entry`、`no_match`、`disabled_node`、`page_variant`。

- `candidateCoverage`：正例的正确目标进入合法候选池的比例。未覆盖与模型选错分开。
- `correctActionRate`：正例实际提出正确动作的比例；拒答不算选对。
- `wrongActionRatePerDecision` 与 `wrongActionRateAmongIssued`：分别以全部决策、已提出动作作分母。无匹配场景点击也算错误动作。
- `modelCalls`：实际调用模型次数；禁用节点或重复匹配在推理前被拒绝，不算模型的语义拒答。样本另保留 `selectedProbability` 和 `margin` 供诊断，它们不是校准后的正确率。
- `positiveRefusals`、`negativeRefusals`、`negativeActionErrors` 与 `refusalReasons`：区分误拒、正确拒答、无匹配时误点，以及规则未配置、模型 abstain、页面不支持、禁用等原因。
- `incrementalCoverage`：模型相对两种规则新增选对和丢失选对的**具体样本 ID**。同页多种表达仍是相关样本，不能当成独立收益。
- `medianDecisionMs`：本地 provider 决策墙钟时间，不包含采树、设备通信、回放、清理和导出，也不是纯模型内核耗时。

`verifierFalsePass.available` 默认是 `false`，计数/比率为 null：离线动作标签不能证明业务验收有无错误放行。只有某个 case 明确附带该 provider 的 `judgeLabels`，才按所提供的独立真机验收记录汇总：

```json
{
  "provider": "laya",
  "businessOutcome": "fail",
  "verdict": "fail",
  "runId": "verification-run-unique-id",
  "independentJudge": true,
  "evidence": {"path": "private/actual-run-labels.json", "sha256": "<64 lowercase hex characters>"}
}
```

`provider` 为 `resource_id`、`text` 或 `laya`；真实业务结果为 `pass/fail`，验收输出为 `pass/fail/not_tested`。这是对已有真机标签的统计，不代表评测器刚执行过该次运行；数据作者须保证标签来源独立可信。相同 provider 与 runId 不能重复挂到多条表达上，避免重复计算同一次运行。总体指标使用提供的记录，按标签细分暂不带入这些外部验收数据。

`maintenance.available` 默认是 `false`，不估算维护次数和节省时间。如果确实保留了维护前后的规则配置，可在清单提供 `maintenance: {before:{path,sha256},after:{path,sha256}}`，统计新增/删除/修改的 goal 映射数。这个数仅表示配置差异，不是维护人时或少写了几条脚本；两份配置仍须标明来自开发集或预置规格。
