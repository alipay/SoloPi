# 支付宝 GoalPath：三条真实页面流程的复现方法

这组用例把一个总目标交给决策器，由它连续选择当前页面上的动作。固定步骤、输入数据和验收条件在运行前冻结。`rules`、`laya`、`llm`、`hybrid` 共用同一份用例和候选生成逻辑；当前配置本身不证明性能提升。

## 三条用例分别验证什么

每轮都从**支付宝首页**开始，先独立检查首页“更多”入口。完成目标后执行固定清理，再检查是否恢复首页。

| 用例与配置 | 固定准备 | 同一个动态探索段 | 独立终态 Oracle | 固定清理 |
| --- | --- | --- | --- | --- |
| `search-draft`：[需求](search-draft/requirement.json) · [策略](search-draft/policy.json) | 首页检查 | 打开搜索，输入冻结文本“天气”，保留草稿 | `search_input_box` 文字为“天气”；`search_confirm` 描述为“搜索” | 点击搜索页 header 返回按钮两次，再验首页 |
| `replace-query`：[需求](replace-query/requirement.json) · [策略](replace-query/policy.json) | 打开搜索、固定输入“天气”，独立检查准备结果 | 把草稿改成冻结文本“计算器”，保留在输入页 | `search_input_box` 文字为“计算器”；搜索确认入口仍在 | 同上 |
| `education-browse`：[需求](education-browse/requirement.json) · [策略](education-browse/policy.json) | 首页检查 | 打开更多服务，再进入教育公益分类 | 同时匹配 `homemarket:id/title` 与文字“教育公益”，并看到 `app_group_item_name` 为“支付宝公益” | 点击更多服务 header 返回按钮一次，再验首页 |

`replace-query` 的规则基线采用“清空 → 输入”；模型可以选择其他合法路径。验收只声明最终草稿正确，实际选择次数与路径看回执，不把额外动作算成收益。教育分类的标题必须带指定资源 ID，不能把导航栏上的同名文字当作完成。

动态段最多执行 6 次动作。两条草稿流程允许 `click/input/wait`，教育分类允许 `click/scroll/wait`。清理只点击指定页面的返回控件，不使用无条件系统返回；页面不符合清理 selector 时会保留失败。搜索页面版本若只需返回一次，应先验证并修改配置，再重新编译、冻结整组对照。

## 决策边界

候选来自当前 Observation 的通用可见、可操作节点，最多 64 个，包含角色、当前值、选中状态和有限父子语义。另提供按树顺序去重的 `pageText`，最多 64 条、每条 128 字符，并明确标注截断，让非交互的加载提示也能进入决策。候选溢出、必要元数据缺失或页面不在 `readyWhen` 范围内时停止。

规则私有的 `rules` 使用稳定资源 ID；允许非交互文字节点映射到最近的可点击祖先，例如首页“更多”。这些规则不传给模型，也不用于提前挑出模型答案。模型只能返回候选索引，不能编造节点或输入；输入只能来自策略的 `inputData`。`done` 只结束探索，是否通过仍由冻结的 Oracle 判断。

两条草稿策略以精确 `denyLabels: 搜索` 排除搜索确认按钮，首页“搜索框”仍可选择；教育策略排除“支付宝公益”动作，允许读取它完成验收。其他金融及授权入口也有共同排除项。这些是本组页面的明确限制，**不是通用业务风险分类器**，也没有把候选缩成唯一答案。

## 准备运行环境

以下命令都在仓库根目录执行。使用包含 GoalPath 所需字段的新 SoloPi APK：`isVisibleToUser` 必须可用，输入节点必须明确 `isPassword=false`。电脑控制使用 host/headless 配置，ADB 与无障碍需就绪；悬浮窗和电池优化白名单不作为 host 执行的必需项。安装及 CLI 基础说明见 [Harness README](../../../README.md)。

```bash
GOALPATH_CLI=./solopi-skill/scripts/harness/solopi-ai
"$GOALPATH_CLI" --pretty doctor
"$GOALPATH_CLI" --pretty capabilities
```

先确认 `doctor.success=true`、`executionProfile=host`，以及 capabilities 的 `settleStrategies` 含 `event-stable-v1`。这些命令默认选择唯一已连接设备；多设备时需自行指定目标设备。运行前把支付宝置于首页，不保留键盘或弹窗。下面明确使用 `--no-restart-app`，不会自动重启支付宝重建初态。

只跑规则不需要模型依赖。Laya 使用 Apple Silicon 宿主机上的 MLX，先准备独立 Python 3.12 环境与固定版本权重；不是手机端推理：

```bash
python3.12 -m venv "$HOME/.cache/solopi-goalpath/venv"
source "$HOME/.cache/solopi-goalpath/venv/bin/activate"
python -m pip install -r solopi-skill/scripts/harness/examples/fastpath/requirements-mlx-lock.txt
GOALPATH_MODEL_DIR="$HOME/.cache/solopi-goalpath/laya-multilingual-mlx-f2b4faf"
hf download aac6fef/laya-multilingual-mlx \
  --revision f2b4faf51023039425946074e2cf1361d2db11d5 \
  --local-dir "$GOALPATH_MODEL_DIR"
```

该目录是社区 MLX 转换版本。GoalPath 在内存中使用 `head_max_len=1024`、`max_len=2048`，不改权重文件；每次推理前检查 option、head 和 state 的真实 token 容量，超限明确拒绝。扩大上下文是实验配置，不代表已经证明更大候选集的准确率。复现入口使用 MLX；缺少可核验容量信息的旧 Laya HTTP 接口会停止或在 hybrid 中升级。

生成式后端需预先提供 OpenAI-compatible 服务。把下面两项替换成实际端口和实际模型 ID；只支持显式 loopback 地址，不自动启动服务：

```bash
GOALPATH_LLM_ENDPOINT='http://127.0.0.1:YOUR_PORT/v1/chat/completions'
GOALPATH_LLM_MODEL='YOUR_MODEL_ID'
```

若该端口通过 SSH 转发连接其他机器，推理仍在远端。记录真实模型和部署位置，并仅向它发送已确认可发送的页面语义。此接口使用严格索引 JSON、`temperature=0` 和关闭 thinking 的配置；小型生成式模型应按实际名称报告，不称为旗舰大模型。

## 编译并选择一种后端运行

将 `GOALPATH_CASE` 改为表格中的任一用例名。需求变化后必须重新编译；策略由 `verify-run` 校验并复制到本轮证据中。

```bash
GOALPATH_CASE=search-draft
GOALPATH_CASE_DIR="$PWD/solopi-skill/scripts/harness/examples/fastpath/goalpath-alipay/$GOALPATH_CASE"
GOALPATH_OUTPUT="$PWD/output/goalpath-reproduction"
mkdir -p "$GOALPATH_OUTPUT/plans/$GOALPATH_CASE"
GOALPATH_PLAN="$GOALPATH_OUTPUT/plans/$GOALPATH_CASE/plan.json"

"$GOALPATH_CLI" --pretty verify-compile \
  --file "$GOALPATH_CASE_DIR/requirement.json" --output "$GOALPATH_PLAN"
"$GOALPATH_CLI" --pretty verify-validate --plan "$GOALPATH_PLAN"

goalpath_run() {
  GOALPATH_MODE="$1"
  shift
  GOALPATH_RUN_DIR="$GOALPATH_OUTPUT/runs/$GOALPATH_CASE-$GOALPATH_MODE-$(date +%Y%m%d-%H%M%S)"
  "$GOALPATH_CLI" --pretty verify-run \
    --plan "$GOALPATH_PLAN" --artifacts "$GOALPATH_RUN_DIR" \
    --decision-provider goalpath --goalpath-policy "$GOALPATH_CASE_DIR/policy.json" \
    --goalpath-mode "$GOALPATH_MODE" \
    --transport-mode shared --settle-strategy event-stable-v1 --no-restart-app "$@"
}
```

下面四种调用任选一种。每次运行前确认首页初态；重复运行会创建新证据目录，若同秒目录重名，CLI 会拒绝覆盖。

```bash
# 稳定资源 ID 等私有规则，不加载模型。
goalpath_run rules

# 只使用宿主机上的 Laya。
goalpath_run laya --fastpath-backend mlx --fastpath-model "$GOALPATH_MODEL_DIR"

# 只使用已配置的生成式服务。
goalpath_run llm \
  --goalpath-llm-endpoint "$GOALPATH_LLM_ENDPOINT" --goalpath-llm-model "$GOALPATH_LLM_MODEL"

# 先 Laya，无法可靠选择时升级到同一生成式服务。
goalpath_run hybrid --fastpath-backend mlx --fastpath-model "$GOALPATH_MODEL_DIR" \
  --goalpath-llm-endpoint "$GOALPATH_LLM_ENDPOINT" --goalpath-llm-model "$GOALPATH_LLM_MODEL"
```

`shared` 只在同一次 verify-run 内复用连接，不跨运行复用页面或动作回执；`event-stable-v1` 使用设备声明的页面稳定策略。结束本轮会话后保持 ADB 开启，以上命令不会关闭系统 ADB。下一轮若初态未恢复，先处理失败并回到首页，使用新的证据目录重跑。

hybrid 在 Laya 拒答、分布非法、未达到阈值、容量不足或服务不可用时升级。三个策略固定 `minProbability=0.65`、`minMargin=0.15`；它们是未校准的路由门槛，不是“65% 正确率”。页面、候选和输入等硬约束失败不会通过升级绕过；自信的错误选择也未必触发升级。

## 判断结果与保留证据

以本轮目录的 `report.json` 为准，同时检查顶层 `status`、各 Oracle 和 `scenarios[].cleanup.status`。`passed`、`failed`、`not_tested` 必须分开；适配层确认冻结停止条件并返回 `done`，或一次点击成功都不等于用例通过。验收未通过时 verify-run 返回非零退出码，不能只看是否生成了截图或报告。

保留冻结计划、`goalpath-policy.json`、`report.goalpath` 运行时信息、动作回执和 `timing.json`。动作回执用于核对实际路径、拒绝及升级次数；计时包含嵌套区间，不能直接相加，也不能把 provider 耗时当作整条任务耗时。失败运行与清理失败应一并保留，不覆盖后只展示成功轮次。

本文只提供复现配置与运行方式。模型收益、完整任务耗时和成功率，需在相同初态、计划、策略及验收条件下重复实测后报告。

实现入口：[GoalPath provider](../../../src/solopi_harness/goalpath.py) · [模型适配器](../../../src/solopi_harness/goalpath_runtime.py) · [CLI](../../../src/solopi_harness/solopi_ai.py)。
