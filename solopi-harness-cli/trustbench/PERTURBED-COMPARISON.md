# 页面变化扰动配对：2026-10-15

协议 `perturbed-comparison-protocol-v1.json` 在执行前冻结。使用 Kimi-K3、4096 输出 token、
60000ms 请求间隔、同一 Redmi 和既有 Notes APK。与正常配对分组保存。
机器可读证据：`perturbed-comparison-result-20261015-v1.json`，含源文件哈希及全部三次尝试。

模型首次决定点 New note 后，注入器先点击该按钮，把列表切为编辑页。
UIAutomator 独立验证编辑页，未调用 session observe 更新原观察；随后原样执行模型旧决策。
两组注入坐标均为 (578,577)，注入后页面资源 ID 集合相同，首次完整模型输入相同。

| 组 | 过期动作 | 最终任务 | 耗时 |
|---|---|---|---|
| direct live-02 | 旧坐标已下发，host_direct_adb | UI、存储及证据审计通过，4 动作/5 决策 | 260.811 秒 |
| harness live-01 | rejected / stale_observation | 未完成，拒绝后终止，1 次动作尝试/1 决策 | 45.576 秒 |

两组均审计 8 个文件、2 个执行段。Harness 的持久化分类为 `not_tested / agent_action_failed`，
这是已运行后因动作拒绝中断，**不是 provider_not_tested，也不是任务通过**。
其存储 PASS 收据不存在，因此汇总中的双组存储设备/APK 校验为 false，不能据此推断设备变更。
本次两组命令均指定 `REDACTED-DEVICE`，无重装、无设备切换。

另有 direct live-01 在初始清空断言失败，模型尚未调用、扰动尚未注入，保留为 setup_failed。
事后权限 doctor 全部通过；采集截图为最近任务界面，但不足以认定失败根因。
随后新目录 live-02 完成实验，不覆盖失败，也不把 setup 失败当作模型能力失败。

## 结论与缺口

本次证明了这个具体扰动下的行为差异：Harness 拒绝过期动作，直接执行组继续下发。
但过期下发并未导致直接组任务失败；Harness 则没有恢复能力，未完成任务。
不能宣称 Harness 任务成功率更高、耗时更短或防止了实际数据损坏。
当前实现缺口是拒绝后的受预算约束的重新观察和重新规划，不能把安全拒绝等同成功。
若实现恢复，必须冻结新策略、重新分组，同样给直接组公平的观察与预算，不能改写本次结果。
单次配对不足以得出普适优越性或可靠性估计。

## 复现

模型桥接启动见 `REPRODUCE.md`，间隔设为 60 秒。运行 `DIRECT-COMPARISON.md` 中命令，
将模块替换为 `solopi_harness.trustbench_perturbed_comparison`，其余参数保持相同。
direct、harness 串行使用新目录；UI PASS 后立即独立存储读回，然后才开始下一次 reset。
通过 `evaluate_attempt` 审计业务结果，额外核对 `perturbation.json` 的注入验证与拒绝收据。
不能仅凭脚本退出码判定扰动实验成功。

新增运行证据共约 2.45 MiB；314 项单元测试通过，未录屏、未采集全量日志。
