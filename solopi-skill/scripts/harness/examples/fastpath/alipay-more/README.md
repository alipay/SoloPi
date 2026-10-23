# 支付宝固定回归：更多服务入口

本用例从支付宝首页点击“更多”区域，验证“更多服务”标题与返回按钮，再点击返回并验证首页“更多”。目标为真实支付宝 `com.eg.android.AlipayGphone`，执行端为 SoloPi 原包 `com.alipay.hulu`，端口 `23342`。

这是已知稳定路径，编译为固定 `operation`，不调用 Laya。真实可点击节点 `home_more_view` 是没有独立文案的 `RelativeLayout` 父节点；有“更多”文案的子节点自身不可点击，因此不把父节点伪造为带标签的 FastPath 候选。

## 来源与验收

选择器来自 2026-09-27、支付宝版本 **12.12.30.8000** 的真实观察：`v6-open-more-before.json`（首页）、`v6-more-page.json`（更多服务页）。所有 selector 均保留真实包名和类名，不冻结运行时 source id、坐标或账号内容。

| 阶段 | 真实节点 | 预期 |
| --- | --- | --- |
| 固定点击 | `com.alipay.android.phone.openplatform.app:id/home_more_view`，`android.widget.RelativeLayout` | 进入更多服务 |
| checkpoint 1 | `com.alipay.android.phone.wallet.homemarket:id/title_bar_content`，`android.widget.TextView` | `text=更多服务` |
| checkpoint 2 | `com.alipay.android.phone.wallet.homemarket:id/title_bar_back`，`android.widget.FrameLayout` | `description=返回` |
| required cleanup | 点击同一返回按钮，再找首页 `com.alipay.android.phone.openplatform.app:id/more_app_text` | `text=更多` |

`requirement.json` 是执行前冻结的输入。编译与静态校验通过只表示结构有效，不表示真机通过。本目录不提供运行结论，也不包含页面原始截图；更多服务页有最近使用记录，不能直接作为公开分享图。

## 编译与校验

在 Bash/Zsh 中设置自己的环境：

```bash
export SOLOPI_REPO="/path/to/SoloPi"
export SOLOPI_ADB="/path/to/android-sdk/platform-tools/adb"
export SOLOPI_SERIAL="YOUR_USB_DEVICE_SERIAL"
export SOLOPI_CLI="$SOLOPI_REPO/solopi-skill/scripts/solopi-ai"
export ALIPAY_MORE_INPUT="$SOLOPI_REPO/solopi-skill/scripts/harness/examples/fastpath/alipay-more/requirement.json"
export ALIPAY_MORE_WORK="$(mktemp -d "${TMPDIR:-/tmp}/solopi-alipay-more.XXXXXX")"

"$SOLOPI_CLI" --pretty verify-compile \
  --file "$ALIPAY_MORE_INPUT" \
  --output "$ALIPAY_MORE_WORK/plan.json" \
  --cases-dir "$ALIPAY_MORE_WORK/cases"
"$SOLOPI_CLI" --pretty verify-validate --plan "$ALIPAY_MORE_WORK/plan.json"
```

计划包含两个 checkpoint、一个固定测试段和一个固定 cleanup 段。CLI 会同时导出这两个固定用例，实际导入由 verify-run 完成。

## 真机执行

先安装本次兼容构建并完成 SoloPi 权限、内部 ADB 连接，核对设备和协议：

```bash
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL" \
  --package com.alipay.hulu --device-port 23342 --pretty doctor
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL" \
  --package com.alipay.hulu --device-port 23342 --pretty capabilities
```

doctor 必须 ready。之后手工打开支付宝首页，关闭已知非关键弹层并等待页面稳定。先 inspect 核对真实入口仍唯一存在：

```bash
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL" \
  --package com.alipay.hulu --device-port 23342 --pretty inspect
```

每次运行都显式保留 `--no-restart-app`，并从已准备的首页开始：

```bash
"$SOLOPI_CLI" --adb "$SOLOPI_ADB" --serial "$SOLOPI_SERIAL" \
  --package com.alipay.hulu --device-port 23342 --pretty verify-run \
  --plan "$ALIPAY_MORE_WORK/plan.json" \
  --no-restart-app \
  --artifacts "$ALIPAY_MORE_WORK/run-01"
```

重跑前先确认本轮已终止、清理完成，并重新准备首页。使用新的 artifacts 目录，例如 `run-02`，不能覆盖上一轮证据。

## 结果归因

只有本轮 `report.json` 中两条 checkpoint 和 required cleanup 全部通过，整体为 passed 且 CLI 退出码为 0，才能宣布入口往返验证通过。失败时保留具体 Oracle/执行/清理原因：页面未到达、节点缺失、错误标题与清理失败应分别判断，不能仅凭一次点击被受理就算通过。

本用例证明真实 App 的稳定路径可以复用固定回放和独立验收；不证明 Laya 推理能力，不覆盖服务内容正确性、支付、账号修改或任意弹窗处理。原始运行报告、日志和截图可能包含个人数据，公开分享前需单独审查，不应直接附上整个 artifacts 目录。
