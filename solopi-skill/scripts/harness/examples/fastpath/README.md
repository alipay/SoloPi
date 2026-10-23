# SoloPi FastPath

历史分享正文、Case 设计和实验记录位于仓库 `docs/harness/fastpath/`，不随 Skill 运行包分发。

当前真机演示目标为支付宝，执行端为原版 SoloPi（`com.alipay.hulu`，端口 `23342`）。下文的订单 Demo 保留为历史受控实验夹具；支付宝实际配置与执行进度以分享正文和 Case 清单为准。

首版将 Laya 接入现有 `DecisionProvider`：模型只从当前页面已观察、可操作、属于目标
应用的少量候选中选择。动作仍经 SoloPi 的页面复核、白名单、预算和回执链执行，
结果仍由原有 Result Judge 与确定性 Oracle 判定。

支持宿主机 MLX、本机 HTTP Laya 服务，以及精确文案规则基线。没有自动升级大模型、
没有修改验收条件、没有 Android 端 Laya 推理，也没有接入 Managed Worker。

## 构建 Demo 与生成计划

原生 Demo 构建见 [android-demo](android-demo/README.md)。生成器只写新的输出目录：

```bash
python3 solopi-skill/scripts/harness/examples/fastpath/prepare_demo.py \
  --output /tmp/fastpath-demo-plans --scenario all
```

生成 baseline、renamed、broken、unknown、disabled 五组独立计划。每组包含
`requirement.json`、`policy.json`、`plan.json` 和固定回放用例。执行前用真机 `inspect`
核对 Demo 的资源 ID；UI 源码中的 ID 不是已经观测到设备节点的证明。

| 场景 | 原有验收要求 | 期望三态 |
| --- | --- | --- |
| baseline | 打开订单详情，订单状态为“已支付” | passed |
| renamed | 同上；按钮改名并换位置 | passed，精确文案基线为 not_tested |
| broken | 同上；详情实际为“已取消” | failed |
| unknown | 同上；未知页面没有合法路径 | not_tested |
| disabled | 同上；目标控件不可操作 | not_tested |

期望仅用于解释对照实验，不输入模型，不改变 Oracle。Demo 额外提供 popup/loading
页面，当前五场景计划未覆盖这两项，不能据此宣称已实现智能等待或弹窗自愈。

## 真实模型运行环境

核心 CLI 不依赖 ML 包。Apple Silicon 上可在独立 Python 3.12 环境安装
`laya-mlx==0.2.0`（社区 MLX 移植），提前下载
`aac6fef/laya-multilingual-mlx` 的固定 revision
`f2b4faf51023039425946074e2cf1361d2db11d5`。不要把权重放入 Git。
本地目录需包含 `model.safetensors`、encoder 和 tokenizer 配置。

以下命令在仓库根目录执行，使用独立环境和固定模型版本（需要联网下载公开依赖与权重）：

```bash
python3.12 -m venv "$HOME/.cache/solopi-fastpath/venv"
source "$HOME/.cache/solopi-fastpath/venv/bin/activate"
python -m pip install -r solopi-skill/scripts/harness/examples/fastpath/requirements-mlx-lock.txt
export FASTPATH_MODEL_DIR="$HOME/.cache/solopi-fastpath/laya-multilingual-mlx-f2b4faf"
hf download aac6fef/laya-multilingual-mlx \
  --revision f2b4faf51023039425946074e2cf1361d2db11d5 \
  --local-dir "$FASTPATH_MODEL_DIR"
python solopi-skill/scripts/harness/examples/fastpath/evaluate_offline.py \
  --model "$FASTPATH_MODEL_DIR" --output /tmp/fastpath-offline-new.json
python solopi-skill/scripts/harness/examples/fastpath/evaluate_no_match.py \
  --model "$FASTPATH_MODEL_DIR" --output /tmp/fastpath-no-match-new.json
```

这是社区转换 checkpoint 的 revision。其来源为官方
`convaiinnovations/laya-multilingual` revision
`052592a15d198d9ad47da779604259b10b47b7aa`；本轮核验了下载文件的完整性，
没有自行重做官方 PyTorch 与社区 MLX 的数值等价验证。历史三模板 pilot 保留全部
请求与响应；上述脚本复现当前 v2 适配器，不冒充重新运行历史各版实现。

MLX adapter 只加载显式提供的本地目录；不会在设备操作期间自动下载模型。
它对 checkpoint 数据文件递归计算 SHA-256，模型加载一次，每次需要选择才调用推理。

用安装了 `laya-mlx` 的 Python 运行现有 CLI，或激活该环境后使用 Skill 薄入口：

```bash
solopi-skill/scripts/solopi-ai --serial SERIAL --package com.alipay.hulu.fastpath \
  --device-port 23343 --pretty doctor
solopi-skill/scripts/solopi-ai --serial SERIAL --package com.alipay.hulu.fastpath \
  --device-port 23343 --pretty verify-validate --plan /tmp/fastpath-demo-plans/renamed/plan.json
solopi-skill/scripts/solopi-ai --serial SERIAL --package com.alipay.hulu.fastpath \
  --device-port 23343 --pretty verify-run \
  --plan /tmp/fastpath-demo-plans/renamed/plan.json \
  --decision-provider fastpath --fastpath-backend mlx \
  --fastpath-policy /tmp/fastpath-demo-plans/renamed/policy.json \
  --fastpath-model /absolute/path/to/local/checkpoint \
  --artifacts /tmp/fastpath-renamed-mlx --restart-app
```

使用原版 SoloPi 时，省略 `--package` 和 `--device-port`，但必须使用已导出
`isEnabled` 的本次构建并通过 doctor。安装独立调试副本及其边界见 Android Demo README。
设备权限、内部 ADB RSA 以及 TCP ADB 开启遵循 SoloPi Skill 的显式授权规则。

## 其他 backend

规则基线使用 `--fastpath-backend rules`，不传 `--fastpath-model`。仅按 policy 的
`exactText` 查找唯一控件，不调用模型；它是刻意限制的文案匹配基线，不能代表所有
规则系统或稳定 resourceId 定位能力。

HTTP 使用 `--fastpath-backend http --fastpath-endpoint http://127.0.0.1:8000/v1/systemone
--fastpath-model multilingual --fastpath-model-version YOUR_PINNED_REVISION`。
兼容上游 `state/questions/criteria` 与 `answers.action.probabilities`；当前不支持需认证的
HTTP 服务。只允许显式本机 IP、禁用代理与重定向。模型服务不持有设备控制权。

## 决策与证据边界

- 候选来自冻结 selector 白名单，必须唯一匹配当前 observation、属于目标包，且可见、
  enabled、clickable；上限 8 个。候选按当前 UI 顺序排列，模型只看到文案，节点 ID
  不进入问题文本。空候选、歧义节点、未知页面、禁用控件均停止。
- `abstain` 总在选项中，但不保证无匹配候选时能够拒答；不能用它承担业务准入判断。
  只接收合法的有限概率分布，模型返回的动作对象永不执行。
- `minProbability/minMargin` 默认为 0，仅是可配置实验门槛，尚未校准为业务准确率。
  Laya 的 entropy confidence 不用于放行动作。
- `stopWhen` 命中后由 FastPath provider 返回 `done`，只结束探索；Laya 自身仅选标签，
  固定 Oracle 独立核对订单状态，不能把 provider 的 done 当成 passed。
- `fastpath-policy.json` 与摘要进入本次运行证据；每步回执保留候选、概率、选择、耗时
  和 `promptTemplateVersion`。`compact-choice-v2` 只将目标纯文本放入 state，问题来自冻结策略。
  MLX 报告另记录模型摘要、运行时版本与加载耗时。
- 模型显式选择 abstain、概率校验失败、未达到配置门槛、模型不可用或未知页面时停止，
  不自动切换到云端大模型。这些检查不能保证识别模型的所有错误选择。

## 验证

```bash
python3 -m unittest discover -s solopi-skill/scripts/harness/tests -v
```

测试覆盖候选约束、跨包与旧节点防线、真实 Laya 响应适配、概率校验、规则差异、
策略快照绑定、独立三态判定和 cleanup。测试里的模型/设备替身只证明协议行为；
真实模型与真机效果应以分享文档所列证据为准。
