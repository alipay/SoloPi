# 支付宝三候选实验：从“我的”页选择入口

这个示例把单候选搜索实验扩展为三候选选择：在真实支付宝“我的”页，从“设置”“首页”“我的”中选择一个入口。它验证候选构造、文字选择与真实点击能否接通，也保留模型拒答、误选和页面检查失败的记录。

推荐先复现 `settings-paraphrase-2`，目标原文为“我想打开设置。”。完整路径是：

**稳定的支付宝首页 → 固定步骤点击“我的” → 检查设置入口 → Laya 从三个候选中选择设置 → 检查设置页标题与返回按钮 → 返回“我的”再回首页 → 检查“更多”。**

这条路径只有中间的入口选择使用模型。准备页面、检查结果和恢复首页都由预先配置的步骤与 Oracle 完成，没有接入任务规划大模型。

## 候选如何变成可执行点击

[主例 policy](settings-paraphrase-2/policy.json) 显式设置：

```json
"candidateResolution": "self-or-clickable-ancestor"
```

“首页”和“我的”的 selector 匹配文字子节点；这些节点本身不可点击，适配器从该节点沿当前观察中的父链寻找最近的可点击祖先。整条路径必须满足所属应用、可见、可用等检查，且不能产生重复或歧义目标。设置入口可以直接点击。

这个模式需要显式启用，默认模式仍要求 selector 匹配的节点本身可点击。新模式从匹配到的来源节点取标签，优先级是 `description → contentDescription → text`，因此设置按钮会使用“设置”描述，而不是其图标字符。回执记录来源节点、点击目标、标签字段和祖先距离，便于核对映射。

三个候选包含当前页“我的”，它作为干扰选项保留；模型若选择它，并不代表任务完成。候选仍来自冻结的 selector 配置，不会自动探索整页。Laya 接收目标和候选文字，不读取截图，没有使用视觉模型。

## 准备与编译

先完成仓库 `docs/harness/fastpath/REPRODUCE.md` 中的完整复现说明中的环境、设备权限和本地 MLX 环境准备。在同一个 Bash / Zsh 终端中，应已经：

- 设置 `FASTPATH_REPO`、`FASTPATH_ADB`、`FASTPATH_SERIAL`、`FASTPATH_TARGET_PACKAGE`、`FASTPATH_MODEL_DIR`；
- 定义 `fastpath_cli` 函数，并激活包含固定版本 `laya-mlx` 的 Python 环境；
- 安装与当前源码对应的 SoloPi 构建，确认 `doctor` 成功且 `health.ready=true`。

本目录需要包含候选祖先解析改动的 CLI，普通旧版不能识别 `candidateResolution`。下列步骤沿用上述函数和环境，不需要重新下载依赖或模型。

设置本示例的独立目录，编译正常例和错误 Oracle 对照：

```bash
export FASTPATH_MULTI_CASES="$FASTPATH_REPO/solopi-skill/scripts/harness/examples/fastpath/alipay-multichoice"
export FASTPATH_MULTI_WORK="$(mktemp -d "${TMPDIR:-/tmp}/solopi-alipay-multichoice.XXXXXX")"

for scenario in settings-paraphrase-2 settings-paraphrase2-wrong-oracle; do
  fastpath_cli verify-compile \
    --file "$FASTPATH_MULTI_CASES/$scenario/requirement.json" \
    --output "$FASTPATH_MULTI_WORK/$scenario/plan.json" \
    --cases-dir "$FASTPATH_MULTI_WORK/$scenario/cases"
  fastpath_cli verify-validate \
    --plan "$FASTPATH_MULTI_WORK/$scenario/plan.json"
done
```

编译与校验不操作手机，每组应返回 `valid=true`。不要直接修改带指纹的 plan；另做实验时应保存新的输入与结果目录，而不是改写这组冻结配置。

## 同一表达的规则与 Laya 对照

**每轮都从稳定的支付宝首页开始，并重新执行 `inspect` 确认。** 等上一轮会话和 cleanup 结束；即使上一轮 cleanup 通过，也不能据此跳过本轮起始页检查。如果有活动弹层，先关闭，再确认首页“我的”入口可操作。下列冷启动命令提供一致的准备方式，不能只靠固定等待或上一轮报告推断页面状态。

先运行 `settings-paraphrase-2` 的规则对照：

```bash
fastpath_cli startup-time \
  --target-package "$FASTPATH_TARGET_PACKAGE" --mode cold --iterations 1
fastpath_cli inspect

fastpath_cli verify-run \
  --plan "$FASTPATH_MULTI_WORK/settings-paraphrase-2/plan.json" \
  --decision-provider fastpath --fastpath-backend rules \
  --fastpath-policy "$FASTPATH_MULTI_CASES/settings-paraphrase-2/policy.json" \
  --no-restart-app \
  --artifacts "$FASTPATH_MULTI_WORK/settings-paraphrase-2-rules-01"

python -m json.tool "$FASTPATH_MULTI_WORK/settings-paraphrase-2-rules-01/report.json"
```

规则 backend 使用同一个候选构造流程，再按 `exactText=设置` 选择，不调用模型。这里 `--no-restart-app` 禁止固定准备段重启目标应用；它本身不负责打开支付宝，cleanup 始终不重启。

重新准备稳定首页，再运行相同 plan、goal、policy 和 Oracle 的 Laya 对照：

```bash
fastpath_cli startup-time \
  --target-package "$FASTPATH_TARGET_PACKAGE" --mode cold --iterations 1
fastpath_cli inspect

fastpath_cli verify-run \
  --plan "$FASTPATH_MULTI_WORK/settings-paraphrase-2/plan.json" \
  --decision-provider fastpath --fastpath-backend mlx \
  --fastpath-policy "$FASTPATH_MULTI_CASES/settings-paraphrase-2/policy.json" \
  --fastpath-model "$FASTPATH_MODEL_DIR" \
  --no-restart-app \
  --artifacts "$FASTPATH_MULTI_WORK/settings-paraphrase-2-mlx-01"

python -m json.tool "$FASTPATH_MULTI_WORK/settings-paraphrase-2-mlx-01/report.json"
```

正常例需要同时满足：固定准备段通过、设置页标题检查通过、返回按钮检查通过、cleanup 回到首页并检查“更多”通过。进入了设置页不能替代完整验收。重复运行时使用新的 artifacts 目录，例如将 `-01` 改为 `-02`。

## 错误 Oracle 对照

使用 [settings-paraphrase2-wrong-oracle](settings-paraphrase2-wrong-oracle/requirement.json)，不要与原来的 `settings-wrong-oracle` 混淆。根据 [control-provenance.json](settings-paraphrase2-wrong-oracle/control-provenance.json)，这个新对照在离线准入后、其真机运行前单独冻结：

- 来源为 `settings-paraphrase-2`，保留目标“我想打开设置。”及相同 policy；
- 仅将第二条目标页 Oracle（`target-2`）的预期从“返回”改为 `FASTPATH_EXPECTED_MISMATCH`；另外重命名了用例标识和标题；
- 不属于原先冻结的九个离线样本。

重新准备稳定首页后执行：

```bash
fastpath_cli startup-time \
  --target-package "$FASTPATH_TARGET_PACKAGE" --mode cold --iterations 1
fastpath_cli inspect

fastpath_cli verify-run \
  --plan "$FASTPATH_MULTI_WORK/settings-paraphrase2-wrong-oracle/plan.json" \
  --decision-provider fastpath --fastpath-backend mlx \
  --fastpath-policy "$FASTPATH_MULTI_CASES/settings-paraphrase2-wrong-oracle/policy.json" \
  --fastpath-model "$FASTPATH_MODEL_DIR" \
  --no-restart-app \
  --artifacts "$FASTPATH_MULTI_WORK/settings-paraphrase2-wrong-oracle-mlx-01"

python -m json.tool "$FASTPATH_MULTI_WORK/settings-paraphrase2-wrong-oracle-mlx-01/report.json"
```

该对照的预期是：成功到设置页，第一条目标页 Oracle 通过，第二条因错误哨兵发生 `oracle_mismatch`，cleanup 通过，整体 `failed`。仅看到 `failed` 不够；模型误选、拒答或未到检查点都不能算这个错误 Oracle 对照成功。它也不代表支付宝存在业务缺陷。

CLI 退出码 `0` 表示 `passed`；`failed` 和 `not_tested` 均为退出码 `2`，必须读取报告区分。如果终端启用了遇到非零退出码就停止的模式，预期失败后请单独执行读报告命令。

## 已冻结的实验结果与边界

[输入清单与摘要](inputs-manifest.json)记录配置来源和 SHA256；仓库 `docs/harness/fastpath/evidence/alipay-multichoice-offline-20260927.json` 中的公开离线摘要保留全部结果。原始“我的”页可能包含账户信息，不随本示例分发。

离线实验使用**同一张真实采集的“我的”页节点快照**，共九例：两个正例目标各三种表达，以及三个在给定候选池内没有正确选项的目标。六种表达是相关变体，不是六个独立页面或六个独立任务。

| 离线方案 | 六种正例表达 | 三个无正确选项目标 |
| --- | --- | --- |
| Laya MLX | 4种正确、1种拒答、1种误选 | 全部误选“首页” |
| 精确标签＋冻结目标映射 | 6种正确 | 因目标未映射而停止 |
| 显式 selector＋冻结目标映射 | 6种正确 | 因目标未映射而停止 |

两个规则基线均预先映射全部六种正例表达，没有通过故意漏配同义表达来弱化规则。selector 使用实际的 description 或 resourceId＋text，不是纯 resourceId 基线。规则负例的“未映射”也不代表规则具有语义拒答能力。这些离线目标只在保存的页面上做选择，没有执行手机动作、Oracle 或 cleanup。

真机只准入离线选择正确的四个正例；其结果是**经过筛选的接入验证**，不能作为整个冻结样本集的端到端成功率：

| 用例 | Backend | 已确认的真机结果 |
| --- | --- | --- |
| `home-direct` | rules | 动作正确；首页 `selected_fl` 检查未找到节点，整体 `failed`；cleanup 通过 |
| `settings-direct` | rules | `passed`；cleanup 通过 |
| `home-direct` | mlx | 动作正确；同一首页 Oracle 未找到节点，整体 `failed`；cleanup 通过 |
| `home-paraphrase-2` | mlx | 动作正确；首页 `selected_fl` 检查未找到节点，整体 `failed`；cleanup 通过 |
| `settings-paraphrase-1` | mlx | `passed`；cleanup 通过 |
| `settings-paraphrase-2` | mlx | `passed`；cleanup 通过 |
| `settings-paraphrase-2` | rules，同表达对照 | `settings-pair-rules-01` 为 `passed`；cleanup 通过 |
| `settings-paraphrase2-wrong-oracle`，第1轮 | mlx | `settings-wrong-oracle-mlx-01` 固定准备检查失败，零模型推理，目标页检查未执行，cleanup 失败；整体 `failed`，未验证错误 Oracle |
| `settings-paraphrase2-wrong-oracle`，第2轮 | mlx | `settings-wrong-oracle-mlx-02` 准备与标题检查通过，第二条目标页 Oracle 因预置错误哨兵失败，cleanup 通过；整体 `failed`，符合控制实验预期 |

以上九份真机报告全部保留，四份 `passed`、五份 `failed`；这些是不同实验条件与重试记录，不合并计算模型成功率。错误 Oracle 对照的第2轮沿用第1轮冻结配置，重新准备并检查起始页后执行；本轮首次动作遭到 `stale_observation` 拒绝，重新观察和决策后成功，因此有两次模型推理、一次被拒绝的动作提议，仅一次成功的动态点击。第1轮的准备与清理失败仍单独保留，不能当作预置错误 Oracle 已生效。

首页用例没有因“点击正确”被改记为通过，也没有为迎合结果临时修改冻结的 Oracle。

未准入 Laya 真机的配置仍然保留：`home-paraphrase-1` 在离线选择中拒答；`settings-direct` 离线误选首页；原 `settings-wrong-oracle` 沿用后者的目标表达，因此未准入。三个无匹配目标也没有把离线错误动作送到手机执行。后续的正确子集不能掩盖这些结果。

这组实验补充了真实多候选构造、意图表达敏感性和固定验收的证据，**没有证明模型优于规则或流程加速**。若比较耗时，需统一起始页、记录完整初始化和手机执行区间，并重复运行；单次决策的毫秒数不能替代包含固定准备段、验收与恢复的总耗时。
