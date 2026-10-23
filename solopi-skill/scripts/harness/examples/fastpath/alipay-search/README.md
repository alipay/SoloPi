# 支付宝搜索页：FastPath 接入与结果判定实验

这组配置用于验证“本地决策 → SoloPi 真机动作 → 独立 Oracle → required cleanup”的接入链路。被测应用为真实支付宝，目标包 `com.eg.android.AlipayGphone`；执行端为原包 SoloPi `com.alipay.hulu`，控制端口 `23342`。

Laya 的候选只有一个“搜索框”，适配器另加 `abstain`。这不能证明小模型比规则更准或更快。搜索框是已知稳定入口，实际回归通常直接使用固定步骤；这里使用动态段是为了验证模型与执行器的接入。

## 三组冻结输入

| 目录 | 变化点 | 完成控制实验时的预期 |
| --- | --- | --- |
| `normal` | 打开搜索页，核对两条 Oracle，再返回首页 | `passed` |
| `wrong-oracle` | policy 与 normal 完全相同；只把搜索确认按钮的 Oracle 预期改为明确测试哨兵 | `failed`，属于故意错误预期，不是支付宝缺陷 |
| `blocked` | 首页真实节点的 `readyWhen` 预期改为测试哨兵，动作前拒绝 | `not_tested` |

表中是实验预期，不是执行结果。每组只有 `requirement.json` 与 `policy.json`，计划及固定 cleanup 用例由本地 CLI 编译。`inputs-manifest.json` 保存配置摘要与预期编译指纹，不包含手机序列号或会话凭据。

## 真实选择器来源

选择器提取于 2026-09-27 的支付宝 **12.12.30.8000**，来自已保存的真实首页观察 `v5-ready-observation.json` 和搜索页观察 `v5-search-page.json`。原始页面树与截图不随本示例分发。版本不同、页面布局不同或出现活动弹层时，先重新 `inspect`，不能认为这些选择器必然适用。

| 用途 | 真实 selector 关键字段 | 冻结预期 |
| --- | --- | --- |
| 唯一动作候选 | `className=android.widget.RelativeLayout`，`description=搜索框` | 可见、enabled、clickable 且唯一匹配 |
| 首页准备条件 | `resourceId=com.alipay.android.tablauncher:id/selected_fl` | `description=首页` |
| 搜索页完成条件与第一条 Oracle | `resourceId=com.alipay.mobile.antui:id/search_back_button` | `description=返回` |
| 第二条 Oracle | `resourceId=com.alipay.mobile.antui:id/search_confirm` | `description=搜索` |
| 清理验收 | `resourceId=com.alipay.android.phone.openplatform.app:id/more_app_text` | `text=更多` |

所有 selector 都保留真实 `className` 和目标 `packageName`。搜索输入框 `search_input_box` 的推荐词会变化，因此未将该值写入 selector 或 Oracle。本实验只打开搜索页，不输入内容、不提交搜索。

`wrong-oracle` 的第二条预期固定为 `SOLOPI_CONTROL_EXPERIMENT_EXPECTED_MISMATCH_20260927`；它没有修改 selector。`blocked` 使用同一哨兵作为首页准备条件的 expected，也没有编造节点。

## 环境与本地编译

以下命令适用于 Bash/Zsh。先将路径、设备序列号替换为自己的环境；`SOLOPI_REPO` 指向包含 `solopi-app` 和 `solopi-skill` 的仓库根目录。

```bash
export SOLOPI_REPO="/path/to/SoloPi"
export SOLOPI_ADB="/path/to/android-sdk/platform-tools/adb"
export SOLOPI_SERIAL="YOUR_USB_DEVICE_SERIAL"
export SOLOPI_CLI="$SOLOPI_REPO/solopi-skill/scripts/solopi-ai"
export FASTPATH_EXAMPLES="$SOLOPI_REPO/solopi-skill/scripts/harness/examples/fastpath/alipay-search"
export FASTPATH_WORK="$(mktemp -d "${TMPDIR:-/tmp}/solopi-alipay-fastpath.XXXXXX")"

for scenario in normal wrong-oracle blocked; do
  "$SOLOPI_CLI" --pretty verify-compile     --file "$FASTPATH_EXAMPLES/$scenario/requirement.json"     --output "$FASTPATH_WORK/$scenario/plan.json"     --cases-dir "$FASTPATH_WORK/$scenario/cases"
  "$SOLOPI_CLI" --pretty verify-validate     --plan "$FASTPATH_WORK/$scenario/plan.json"
done
```

这一步不连接手机。三组均须 `success=true`、`valid=true`；每组包含两条 checkpoint 与一个固定 cleanup 段。编译指纹应与 `inputs-manifest.json` 一致。不要为了迎合运行结果，在同一次验证中修改 policy 或 Oracle。

## 设备准备

手机需要安装包含 FastPath 兼容修复的 SoloPi 构建，授予 SoloPi 必需的辅助功能、悬浮窗、电池优化白名单，并完成内部 ADB 连接及系统 RSA 授权。

```bash
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL"   --package com.alipay.hulu --device-port 23342 --pretty doctor
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL"   --package com.alipay.hulu --device-port 23342 --pretty capabilities
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL"   --package com.alipay.hulu --device-port 23342 --pretty apps
```

确认 doctor `ready=true`，设备支持动态 Agent 与验证所需协议，且已安装目标支付宝。随后手工打开支付宝首页、关闭已知非关键弹层，等页面稳定；再运行 `inspect` 核对首页与搜索框。每次对照实验都从这个状态重新开始，期间不要再执行会切换前台的其他控制命令。

```bash
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL"   --package com.alipay.hulu --device-port 23342 --pretty inspect
```

尤其是 `blocked` 必须从首页启动：适配器先检查 `stopWhen`，已经在搜索页会直接结束探索，无法验证首页准备条件阻断。

## 先跑规则基线

先选择 `normal`，显式使用 `--no-restart-app` 保留手工准备的页面。此参数控制固定段的启动策略，并不负责打开支付宝；本例没有启动应用的固定步骤。cleanup 始终不重启应用。

```bash
export FASTPATH_SCENARIO="normal"
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL"   --package com.alipay.hulu --device-port 23342 --pretty verify-run   --plan "$FASTPATH_WORK/$FASTPATH_SCENARIO/plan.json"   --decision-provider fastpath --fastpath-backend rules   --fastpath-policy "$FASTPATH_EXAMPLES/$FASTPATH_SCENARIO/policy.json"   --no-restart-app   --artifacts "$FASTPATH_WORK/$FASTPATH_SCENARIO-rules-01"
```

要跑其余两组，将 `FASTPATH_SCENARIO` 分别改为 `wrong-oracle`、`blocked`，每次先重新确认支付宝首页，再执行同一命令。重新运行同一组时换一个不存在的 artifacts 目录，例如末尾改成 `-02`。规则基线只按 `exactText=搜索框` 选择，不调用模型。

## 再跑本地 Laya / MLX

MLX 路径需要 Apple Silicon 和独立 Python 3.12 环境。已有环境和模型可直接激活并设置 `FASTPATH_MODEL_DIR`；新环境可运行下列准备命令，公开依赖与权重下载需要网络。模型不在手机上推理。

```bash
export FASTPATH_VENV="$HOME/.cache/solopi-fastpath/venv"
export FASTPATH_MODEL_DIR="$HOME/.cache/solopi-fastpath/laya-multilingual-mlx-f2b4faf"
python3.12 -m venv "$FASTPATH_VENV"
source "$FASTPATH_VENV/bin/activate"
python -m pip install -r "$SOLOPI_REPO/solopi-skill/scripts/harness/examples/fastpath/requirements-mlx-lock.txt"
hf download aac6fef/laya-multilingual-mlx   --revision f2b4faf51023039425946074e2cf1361d2db11d5   --local-dir "$FASTPATH_MODEL_DIR"
```

该 checkpoint 是社区 MLX 转换，来源为官方 `convaiinnovations/laya-multilingual`，不是 Jev 模型。固定 revision 用于复现；这里没有声明官方 PyTorch 与社区 MLX 数值等价已完成验证。

重新准备同一支付宝首页后运行：

```bash
export FASTPATH_SCENARIO="normal"
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL"   --package com.alipay.hulu --device-port 23342 --pretty verify-run   --plan "$FASTPATH_WORK/$FASTPATH_SCENARIO/plan.json"   --decision-provider fastpath --fastpath-backend mlx   --fastpath-policy "$FASTPATH_EXAMPLES/$FASTPATH_SCENARIO/policy.json"   --fastpath-model "$FASTPATH_MODEL_DIR"   --no-restart-app   --artifacts "$FASTPATH_WORK/$FASTPATH_SCENARIO-mlx-01"
```

其余组同样分别修改 `FASTPATH_SCENARIO`，每次确认首页后单独运行；不要把三组连成无人检查的循环。`blocked` 在模型决策前由 readyWhen 拒绝，所以即使用 MLX backend 也不应把这次阻断算作模型拒答成绩。

## 如何读结果

最终看本次 artifacts 中的 `report.json`。CLI 退出码 `0` 对应 `passed`，`failed` 与 `not_tested` 都是退出码 `2`，必须查看 report 的状态和具体原因区分。

- `normal`：两条搜索页 checkpoint 通过，required cleanup 点击返回并证明首页“更多”存在，才能通过。
- `wrong-oracle`：应沿相同策略到达搜索页，第一条 checkpoint 通过，第二条因测试哨兵不匹配失败，cleanup 仍通过。这才能归因为“独立 Oracle 拒绝故意错误预期”。
- `blocked`：从首页被准备条件阻断，搜索页 checkpoint 未到达，cleanup 只断言首页“更多”。这才能归因为“受控未覆盖”，而不是业务失败。

模型 `done` 只结束探索，不能宣布通过。检查每轮的 policy 摘要、计划指纹、候选与模型回执、动态动作/观察、checkpoint 和 cleanup 证据；不能把另一轮截图或成功轨迹补进当前报告。

若模型 abstain、页面旧观察被拒绝、发生广告跳转或搜索入口未打开，normal/wrong-oracle 的固定返回清理可能也失败；不能只看 overall failed 就称错误 Oracle 验证成功。遇到 `stale_observation` 必须重新观察和决策，不把旧动作盲目重放。先结束或取消本轮准确会话，确认租约释放，再准备下一轮。

本实验不覆盖支付、转账、账号修改、搜索提交、结果页业务正确性、通用弹窗自愈，也不量化模型能力优势。运行产生的原始 UI、截图和日志可能包含个人内容，公开分享前另行筛选和脱敏；本示例配置本身未携带这些内容。
