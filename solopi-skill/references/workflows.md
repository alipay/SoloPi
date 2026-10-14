# 内置真机工作流

Skill 提供统一使用入口，Harness 负责计划、执行编排和独立验收，SoloPi APK 负责采集与受约束执行。
Laya 是可选的电脑本地决策器；使用这套流程不需要把模型或 Python Harness 打进 APK。

## 安装与目录

完整的 `solopi-skill` 目录包含 `scripts/harness/src/solopi_harness` 及内置模板，可以独立复制到
Skill 安装位置（例如 `~/.codex/skills/solopi-ai`）。不要只复制 `SKILL.md` 或启动脚本。
使用绝对路径运行 `scripts/solopi-ai`，可从任意工作目录调用；相对输入和输出路径仍相对于调用者目录。

默认规则模式需要 Python 3.9+，无需额外安装 Harness Python 包；真机操作另需 ADB、配套 APK 和所需权限。
Laya 的 Python 环境与权重按需配置。源码内保留测试和打包配置，开发者仍可在虚拟环境中安装
`scripts/harness`；Python 包名保持 `solopi-harness-cli`。
运行前可在未连接手机时用 `scripts/solopi-ai --help`、`scripts/solopi-ai workflow-list` 检查入口。

## 选择与执行

先运行 `workflow-list`，再按用户意图选择模板。三个模板都要求已登录的支付宝首页，且没有键盘和弹窗。
它们只浏览和返回；不支付、不提交表单、不修改设置。

| 模板 ID | 流程 | 固定验收 |
|---|---|---|
| `alipay-more-services` | 首页 → 更多服务 → 首页 | 更多服务标题、返回入口、首页恢复 |
| `alipay-education` | 首页 → 更多服务 → 教育公益分类 → 首页 | 分类内容标题、支付宝公益入口、首页恢复 |
| `alipay-settings` | 首页 → 我的 → 设置 → 我的 → 首页 | 设置入口、页面标题、返回入口、首页恢复 |

```bash
scripts/solopi-ai --pretty workflow-list
scripts/solopi-ai --serial <adb-serial> --pretty workflow-run --template alipay-more-services
```

解析 `scripts/solopi-ai` 为本 Skill 下的绝对路径。保持调用者工作目录；全局参数放在子命令前。
不需要用户提供 plan/policy JSON；它们作为 Harness 包资源随版本发布，运行前冻结到独立证据目录。
默认输出 `~/.solopi-ai/runs/<模板>-<时间>-<随机ID>`，也可传 `--artifacts <新目录>`；不会覆盖已有目录。

## 默认模式与 Laya 实验

默认 `--mode rules --profile optimized`：复用连接，启用设备声明支持的事件稳定等待和目标上下文校验。
不加载模型、不访问模型服务。设备不支持所选策略时停止，不能静默修改配置后仍声称运行相同方案。
`--profile baseline` 显式选择旧等待策略和完整页面校验，用于兼容或对照；它仍复用连接、保留同样的验收和截图。

配套 APK 在动态 `click` 接受前检查新采集页面：目标若与无父子关系的可见、可交互节点重叠，返回
`target_occluded`；目标几何信息缺失则返回 `target_geometry_unknown`。两种校验策略均保留此检查，
列表节点回退到整页校验时也不能跳过。遇到拒绝应保留证据，不能改用裸坐标重试。
该检查来自无障碍节点树，可能保守拒绝重叠布局；它不是视觉模型，也不证明能发现所有自绘遮挡。
需要使用包含此修复的 APK；只更新电脑上的 Skill 不会更新手机端检查。固定回放不应被描述为已获得此动态点击检查。

用户明确选择实验时才运行：

```bash
scripts/solopi-ai --serial <adb-serial> --pretty workflow-run \
  --template alipay-more-services --mode laya --model <本地MLX权重目录>
```

前提是当前 Python 环境已安装 `laya-mlx`，本地目录中有兼容的 `model.safetensors` 与配置。
先激活用户现有的模型环境；不自动下载权重、不安装模型 companion、不隐式转到远端大模型。
本地 MLX 模式适用于现有 Apple Silicon 环境；其他主机先使用规则模式。
Laya 只在冻结候选和门限内选择动作，可能拒答或产生 `not_tested`。这些模板不构成模型优于规则的准确率证明。

## 查看报告

```bash
scripts/solopi-ai --pretty workflow-report --artifacts <workflow-run返回的artifacts>
```

该命令不连接手机，核对文件摘要、目录边界及本次 `reportId/planFingerprint/status`，再返回报告位置。
结果目录包含：

- `REPORT.md`：验收、清理及初始/各执行段/最终整屏截图。
- `workflow.json`：模板、模式、配置、耗时、三态结果和文件摘要。
- `requirement.json`、`policy.json`、`plan.json`：本次冻结输入。
- `run/report.json`、`run/events.jsonl`、`run/timing.json`：原始验收、事件和分段耗时。
- `initial.png`、`run/screenshots/*.png`、`final.png`：原始 PNG，不裁剪或拼成局部图。

业务结论 `status` 为 `passed/failed/not_tested`；工作流 `state` 为 `completed/stopped/interrupted/running`。
只有 `success=true`、`state=completed`、`status=passed` 且退出码 0 才是完整成功。
截图失败可能同时出现业务 `passed` 和工作流 `stopped`，此时必须说明证据未完整导出，不得宣称全部完成。
业务 `failed/not_tested` 均返回非零退出码；前置页面不符、模型拒答、业务断言失败应分别说明。

工作流耗时包含预检、执行、必要清理与截图；`run/timing.json` 的 `verification.screenshot` 单列执行段截图开销。
不能将此端到端耗时与模型单题延迟相比较，也不能把规则模式的运行优化归因于 Laya。
文件摘要用于检查本地证据是否改变，不是签名或防篡改认证。目录默认仅当前用户可访问；对外分享前检查整屏截图中的个人信息。

## 故障处理

- USB 显示 `unauthorized`：需要用户在手机确认 Android 系统 RSA 授权，不能代替点击。
- 仅 SoloPi 内部 `adb` 缺失：使用 `adb-connect`，核对终态与 doctor；不擅自改地址或重启 ADB。
- 无障碍等权限缺失：按 doctor 的实际缺失项处理。host 模式不强制悬浮窗或电池白名单。
- 初始页面不符：先报告未测试；根据用户已授权的范围恢复支付宝首页，再发起新的运行目录。
- 动态点击被遮挡：保留 `target_occluded` 回执，核对整屏截图；不得为了通过测试放宽点击检查或固定验收。
- `running` 或中断：先检查本次 session/run 的终态和归属，按协议确认清理；不要盲目重发动作。
- 模型环境缺失：保留为可选能力未就绪，不为跑通而调整门限或改验收条件。

自定义业务仍用 `verify-compile → verify-validate → verify-run`，见[验证工程](verification-engine.md)。
`verify-run --segment-screenshots` 可单独启用同样的整屏截图；原有调用默认关闭，避免改变已有计时口径。
