# 视觉回归：先采集证据，再判断收益

此目录的 `protocol.json` 是待验证的方案，没有真实截图、任务执行结果或收益数据。四个支付宝任务的实际入口和 SoloPi/Artemis 共同支持情况仍为 unverified；内部 Qwen3.8-Flash-Next 已通过合成输入的纯文本和图像兼容预检；模型不可变部署版本、执行器 revision、提示词版本、规则和数据集哈希仍须在正式运行前补齐。当前只能生成不可执行的草稿轮次清单。

在 `solopi-skill/scripts/harness` 目录运行下面命令；源码运行方式设置 `PYTHONPATH=src`，安装了本地 harness 包时可省略。工具不自动操作设备，不自动发送评测结果。

```sh
PYTHONPATH=src python3 -m solopi_harness.vision_benchmark schedule \
  --protocol examples/vision-regression/protocol.json \
  --out /tmp/vision-schedule-draft.json --draft
```

草稿包含计划清单，不包含测量值，`status=draft`、`executable=false`。删除 `--draft` 后，未冻结或未验证的协议会被拒绝。正式生成前，将独立人工发现的页面证据、固定规则与截图样本冻结，补齐哈希和时间，设为 `state=frozen`。发现记录必须为 `verified`，每个任务需有至少一项可验证文件引用。示例中的 `REPLACE_WITH_...` 和 `latest` 等浮动版本不能用于正式调度。冻结时间不得早于规则声明或数据集冻结时间。

```sh
PYTHONPATH=src python3 -m solopi_harness.vision_benchmark validate-dataset \
  --manifest ./dataset/manifest.json

PYTHONPATH=src python3 -m solopi_harness.vision_benchmark schedule \
  --protocol ./frozen/protocol.json --out ./results/schedule.json
```

正式清单固定为 320 轮：八任务 × SoloPi rules / 同一实际 VLM 的 text / vision × 10 轮，共 240 轮；四条双方共同支持的真实支付宝只读流程 × Artemis Flash / Pro 运行模式 × 10 轮，另 80 轮。补充实验使用独立的 `artemis-flash`、`artemis-pro` arm，不使用受控 App 四组，也不复用 SoloPi 的 `same-model-vision` 结果。每轮先按冻结 seed 打散任务，再交错各 arm；同一任务同一轮各 arm 共享 `trialSeed`。清单只含调度信息、执行器说明与身份哈希，不含预期答案、安全标签或判分条件。

`google/artemis` 是 Agent 框架；Flash/Pro 是该框架的运行模式，不能写成模型 provider 或型号。每个 arm 独立声明 `runner={framework,mode,revision}`；主试验为 `solopi-goalpath`，补充试验为 `google/artemis`。实际模型仍单独记录为 `model={provider,name,version}`，模型参数另记 `config`。正式冻结要求主试验三个 arm 使用同一 SoloPi revision，text/vision 的 runner、实际模型和配置一致；Artemis 两模式使用同一框架 revision，四条支付宝流程的 `discovery.runnerSupport` 必须明确核验 SoloPi、artemis-flash、artemis-pro 均可支持。示例中的所有未知型号、后端配置和 revision 均为占位，未声明任何一个模式已经运行。

本调度/摘要模块不调用 Artemis。Artemis 实际运行及结果导入仍需由其执行器产生证据，并按冻结身份写逐轮记录；这里没有虚构的 Artemis CLI 命令。底层模型配置与运行模式分别核对，Flash/Pro 不作为模型规格比较。

逐轮 JSONL 由实际执行器生成，每行对应清单中的一项，不允许把缺轮补写成通过。字段约定如下。

| 字段 | 类型与规则 |
|---|---|
| `experimentId`、`taskId`、`arm`、`round` | 从清单逐项复制；round 为 1–10 的整数；四项构成唯一键 |
| `protocolSha256`、`armIdentity` | 从冻结清单复制，用来核对协议、规则或模型配置身份 |
| `runnerIdentity` | 所有 arm 必填，独立核对 framework、mode、revision；不能把 Flash 回执当作 Pro 或 SoloPi 回执 |
| `modelIdentity` | 模型 arm 必填，从清单复制；text 与 vision 同模型同配置的身份必须一致 |
| `status` | 保留原始 `passed`、`failed` 或 `not_tested`；任务断言失败写 failed，基础设施阻断及任务级拒答仍写 not_tested，不能把正确拒答改成 passed |
| `elapsedMs` | 有限非负数，按协议 `timing.elapsedScope` 使用 host monotonic wall time 计时 |
| `wrongActions`、`falsePasses`、`manualInterventions` | 必填非负整数；缺字段不能当 0；人工介入指执行中需要人帮助推进的次数 |
| `phase` | 必填 `cold` 或 `warm`；是否包含模型初始化按冻结计时口径记录 |
| `sentinelChecked` | 安全哨兵必须为 true |
| `evidence` | 证据引用字符串数组；哨兵必须非空；只记稳定引用，不写凭证、原始账户信息或完整 UI payload |
| `failureClass` | 普通通过/失败可选 task / none；基础设施失败写 infrastructure 与 not_tested，使账本 incomplete；任务级拒答必须显式为 task |
| `outcomeObserved` | 任务级 not_tested 拒答必须为 true，且 evidence 非空，表示结果已独立核验；缺失或 false 均不能算已评估 |
| `temperature` | 可选；给出时必须与冻结模型配置一致 |
| `stageTimingsMs` | 可选，阶段名到非负 inclusive ms 的映射；阶段可重叠，不能相加得总耗时 |
| `usage` | 可选，非负整数 `inputTokens`、`outputTokens`、`imageTokens`；未记录时不推算 |
| `cost` | 可选 `{amount: 非负数, currency: 币种标识}`；只按相同币种求和，并报告成本记录覆盖率 |
| `automaticTestFixture` | 自动测试数据必须为 true；此类行或数据集均不能成为真实收益证据 |

```sh
PYTHONPATH=src python3 -m solopi_harness.vision_benchmark summarize \
  --protocol ./frozen/protocol.json \
  --rows ./results/rounds.jsonl --out ./results/report
```

命令生成可重建的 `summary.json` 与中文 `summary.md`。不完整报告仍落盘，退出码为 2；完整报告退出码为 0。完整与收益达标是不同字段：完整实验可以得出“未达标”的结论。普通失败计入固定计划分母。dialog/disabled/no-target 的任务级拒答可以保留 not_tested 并补 `failureClass=task`、`outcomeObserved=true` 和非空独立核验证据，成为完整账本中的已评估结果；不增加通过率分子。工具核对声明与引用完整性，引用对应的真实证据仍需独立复核。基础设施阻断、无证据的 not_tested、缺轮、重复、未知轮次、错误身份、缺计数或缺哨兵核验仍使报告 `incomplete`，所有收益值留空。每条问题保留行号和固定原因码，不丢弃重复后继续计算收益。

摘要分别报告 `recorded`（所有匹配的输入记录，含重复/无效）、`evaluated`（唯一有效的已评估结果，含有证据的任务级拒答）、`tested`（其中 passed+failed）、`passed`、`failed`、`notTested`（已评估拒答）和 `unevaluatedPlanned`。`recordedStatusCounts` 保留无效/基础设施原始三态数量，`evaluatedStatusCounts` 表示有效三态。通过率固定为 passed/计划轮次；困难场景 8/10 也只数 passed，八次 passed 加两次已核验拒答符合 8/10，拒答本身不计通过。

成本、用量、错误动作、错误放行、人工介入和耗时统计覆盖全部 evaluated 结果，包括失败和核验拒答。`timingOverall` 同时报计划数、未评估数及有效样本 N；`timingByPhase` 分 cold/warm 报 N、中位数、P95。P95 使用 nearest-rank `ceil(0.95×N)`，N<20 时通常是样本最大值，只作小样本描述，不宣称稳定尾时延；账本不完整时不推算缺失耗时。各阶段 inclusive N/中位数/P95 独立报告，不能把重叠阶段相加。

主试验的 vision 通过率须比同模型 text 高至少 10 个百分点；相对 rules 的通过率差值只作比较报告，不设额外收益门槛。至少两个预先标注的困难任务须达到 8/10；候选 arm 的所有哨兵必须完整核验且错误动作、错误放行都为 0，候选所有任务的错误放行与人工介入也必须为 0。Artemis Flash/Pro 模式的真实支付宝流程结果单独列出，不代替同模型 text/vision 对照。摘要用 `comparisons[].controlsPromotion` 标识比较是否影响放行；rules 项的 `minimumGainPp` 与 `passed` 为 null。工具只计算冻结样本上的观察增益，未声明统计显著性；人工证据引用的真实性仍需复核。

冻结截图 manifest 的结构为：

| 字段 | 约定 |
|---|---|
| `schemaVersion` | `solopi.ai.vision-benchmark-dataset/v1` |
| `datasetId`、`frozenAt` | 稳定标识与带时区的 ISO 8601 冻结时间 |
| `groups` | 数组，每项含 `groupId`、`sourceGroupId`、`split`（dev / holdout）；同一原始页面及其变体使用同一个 sourceGroupId，禁止跨 split |
| `samples` | 数组，每项含 `sampleId`、`taskId`、`groupId`、`screenshot`、`expected`、`provenance`，可含 `request` |
| `screenshot`、`expected`、`request` | `{path, sha256}` 文件引用；path 相对 manifest 所在目录，禁止绝对路径、`..` 和符号链接逃逸；sha256 为 64 位小写十六进制 |
| `provenance` | captured / controlled / automatic_test_fixture；仅为来源声明，哈希本身不证明真实采集来源 |
| `screenshot` 内容 | 校验 PNG/JPEG 文件标记与完整文件哈希；同一截图不能以新 groupId 重命名后跨 split |
| `expected` 内容 | 非空 JSON object，由本地 judge 独立读取；不会出现在调度清单、模型请求或摘要中 |
| `request` 内容 | 可选冻结 JSON object；离线 evaluator 需要它，具体字段由 evaluator 校验；不含预期答案 |

协议要求 dev 60、holdout 120，八个任务都必须在两个 split 有样本。先用 dev 选择配置，冻结后一次性评估 holdout；按 sourceGroupId 隔离页面及其布局变体，不能仅重新命名 groupId。`validate-dataset` 检查所有 split 的哈希后才允许正式调度。受控 App 样本写 controlled，自动单元测试样本写 automatic_test_fixture。

离线 API 评测可在已有冻结截图上对比同一模型的 text 与 vision，并交换候选顺序检测位置偏置。先设置明确的 `VISION_API_ENDPOINT`、`VISION_API_HOST`、`VISION_MODEL_ID` 和凭据环境变量；本轮内部服务参数见 [视觉回归指南](../../../../references/vision-regression.md)。text/vision 的输出 token 预算必须相同，默认 128；本轮因模型推理 token 开销固定为 2048：

```sh
PYTHONPATH=src python3 -m solopi_harness.vision_evaluate \
  --manifest ./dataset/manifest.json \
  --endpoint "$VISION_API_ENDPOINT" --model "$VISION_MODEL_ID" \
  --api-key-env SOLOPI_INTERNAL_VISION_KEY --allowed-host "$VISION_API_HOST" --max-output-tokens 2048 \
  --output ./results/offline-dev --split dev --limit 20
```

密钥通过已经设置的环境变量读取，不写入 manifest、命令行参数值或报告。每个样本执行 text-forward、text-reverse、vision-forward、vision-reverse 四请求；模型只收到冻结语义输入及 vision 截图，`expected` 留在本地判分。离线评测要求 PNG 截图，`request` 是 GoalPath 七字段语义请求，可带经验证的 visual 证据；`expected` 为 `{choice: candidate_N 或 abstain}`。holdout 不允许 `--limit`。离线选择正确率不等同于设备执行成功率、哨兵验证或完整端到端收益，不能直接充当 320 轮回归的通过结果。

API 入口为 `load_protocol(path)`、`schedule(protocol, draft=False)`、`validate_dataset(manifest_path, expected_counts=None)`、`load_rows(path)`、`summarize(protocol, rows)` 和 `write_summary(summary, out_dir)`。正式 schedule 必须使用同进程内 `load_protocol` 实际校验过的冻结协议；修改已加载协议会使身份失效。JSON 中自行声明校验完成不能绕过文件校验。

自动测试执行：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_vision_benchmark.py -v
```

测试仅使用明确标注的自动 fixture，验证协议校验、分组隔离、哈希、缺轮/重复、门槛、计时及可重生成报告，不作为真实收益数据。
