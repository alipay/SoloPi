# 支付宝搜索页：提示表达 v2 开发实验

本目录保留三组新版输入；父目录中的原版输入保持不变。目标仍为支付宝 `12.12.30.8000`，包名 `com.eg.android.AlipayGphone`，执行端为原包 SoloPi `com.alipay.hulu`。

## 为什么增加 v2

在一帧已保存的真实首页观察上，原始问法的 preflight 选择 `abstain`，概率为 `0.928`。随后试验 4 种问法，只有 `short` 选择唯一合法候选 `candidate_0`，概率为 `0.6807`；其余 3 种仍选择 `abstain`。

因此将 `short` 冻结为 v2，用于后续真机接入实验。**这是同一保存帧上的开发调优，不是独立测试集，不是手机动作执行结果，也不能证明模型比规则更好。** 概率不是正确率；提示表达敏感性是本轮发现的限制。

| 字段 | v2 值 |
| --- | --- |
| `requirement.scenarios[].steps[id=open-search].goal` | `打开搜索页。` |
| `policy.steps.open-search.instructions` | `选择完成请求需要点击的控件。` |

仅修改以上两个字段。动作白名单、候选 selector、页面条件、预算、Oracle 和 required cleanup 均与原版一致。`allowedActions` 只有 `click`，可执行候选只有真实搜索框，不提供输入或提交搜索动作；简化 goal 不会扩大动作权限。

`inputs-manifest.json` 保存三组输入 SHA256、编译指纹、策略摘要和开发实验来源摘要。原始 UI 树、设备标识和会话凭据不随示例分发。

## 三组输入

| 目录 | 冻结的控制变量 | 满足实验条件时的预期 |
| --- | --- | --- |
| `normal` | 打开搜索页，两条真实 UI Oracle，返回并确认首页 | `passed` |
| `wrong-oracle` | policy 与 normal 相同；第二条 Oracle 使用错误测试哨兵 | `failed`，属于预设错误预期，不代表支付宝缺陷 |
| `blocked` | 首页 `readyWhen` 使用错误测试哨兵；清理只验首页 | `not_tested`，在模型推理前阻断 |

表中列出实验预期。实际状态必须读取本次运行报告，不能从目录名推断。

## 编译和运行

先按[原版说明](../README.md)准备 `SOLOPI_REPO`、`SOLOPI_CLI`、`SOLOPI_ADB`、`SOLOPI_SERIAL`、`FASTPATH_MODEL_DIR` 与 MLX 环境，完成 doctor 和 capabilities 检查。v2 使用独立工作目录，并从本目录重新编译，不能复用原版 plan。

```bash
export FASTPATH_EXAMPLES="$SOLOPI_REPO/solopi-skill/scripts/harness/examples/fastpath/alipay-search/prompt-v2"
export FASTPATH_WORK="$(mktemp -d "${TMPDIR:-/tmp}/solopi-alipay-prompt-v2.XXXXXX")"

for scenario in normal wrong-oracle blocked; do
  "$SOLOPI_CLI" --pretty verify-compile \
    --file "$FASTPATH_EXAMPLES/$scenario/requirement.json" \
    --output "$FASTPATH_WORK/$scenario/plan.json" \
    --cases-dir "$FASTPATH_WORK/$scenario/cases"
  "$SOLOPI_CLI" --pretty verify-validate \
    --plan "$FASTPATH_WORK/$scenario/plan.json"
done
```

编译与校验不连接手机；三组都必须 `success=true`、`valid=true`。它们证明结构及指纹正确，不代表设备执行通过。

每一轮先确认支付宝处于稳定首页，搜索框真实可操作，没有阻挡弹层，并确保上一轮会话与清理结束。尤其不要从搜索页运行 `blocked`：`stopWhen` 先于 `readyWhen` 判断，已到搜索页便不能验证预期的首页阻断。

```bash
export FASTPATH_SCENARIO="normal"
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL" \
  --package com.alipay.hulu --device-port 23342 --pretty verify-run \
  --plan "$FASTPATH_WORK/$FASTPATH_SCENARIO/plan.json" \
  --decision-provider fastpath --fastpath-backend mlx \
  --fastpath-policy "$FASTPATH_EXAMPLES/$FASTPATH_SCENARIO/policy.json" \
  --fastpath-model "$FASTPATH_MODEL_DIR" \
  --no-restart-app \
  --artifacts "$FASTPATH_WORK/$FASTPATH_SCENARIO-mlx-01"
```

规则对照将 backend 改为 `rules`，去掉 `--fastpath-model`，并使用新的 artifacts 目录。其他两组分别修改 `FASTPATH_SCENARIO`，每轮重新准备和检查首页。重复同组时也必须更换 artifacts 目录，不能覆盖上一轮证据。

## 判读边界

- `normal` 必须两条目标页 checkpoint 通过且 cleanup 通过，才算本轮完成。
- `wrong-oracle` 必须到达搜索页、第一条 checkpoint 通过、第二条因哨兵不匹配失败且 cleanup 通过，才能证明预期的错误断言被拦截。
- `blocked` 必须在首页以 `unsupported_page` 阻断、未执行动作、目标 checkpoint 未到达且首页清理断言通过。它验证策略前置检查，不能记成 Laya 的拒答能力。

若模型 abstain、旧观察被拒绝或页面跳转到广告，normal/wrong-oracle 的固定返回清理也可能失败。此时必须读具体原因，不能把总体 `failed` 当成错误 Oracle 对照成功。模型 `done` 仅结束探索；是否通过由固定 Oracle 和本轮证据判定。

当前只有一个合法候选加 `abstain`，稳定规则足以处理该入口。这个实验用于验证接入和结果判定，不衡量复杂候选选择、通用页面修复或端到端加速。
