# 同模型直接执行与 Harness 配对实验

后续页面变化扰动的独立结果见 [PERTURBED-COMPARISON.md](PERTURBED-COMPARISON.md)。

目标是测量 Harness 的增益，不预设胜负。历史脚本对照不能替代直接 Agent 对照。
协议：`direct-comparison-protocol-v1.json`，在首个配对运行前冻结。

两组共用 Kimi-K3、提示词、解析器、只读页面观察、初始 reset、600 秒总预算、
120 秒空闲预算、8 步上限、4096 输出 token、60 秒请求起点间隔及 UI/独立存储判定。
直接组按观察坐标通过 ADB 执行；Harness 组仍调用原有受保护接口。
直接组的执行记录明确标记 `host_direct_adb`，不是设备安全校验收据。

这是共享 SoloPi 观察器的执行层消融，不是完全独立第三方 Agent 排名。
ADB 输入与 Harness 输入实现不同，因此不能把全部差异归因于过期页面保护。
两组都保留公共 fixture 白名单和预算约束；不是允许任意 shell 的直接 Agent。
单一正常任务的一次配对不足以建立可靠性或普适优越性。后续扰动必须先冻结协议并对两组同样施加。

## 复现

从仓库根目录执行，先按 `REPRODUCE.md` 配置并启动同一个 60 秒间隔模型桥接进程。
按 direct、harness 的顺序串行执行，使用独立新目录；每组 UI 通过后、下一组 reset 前立即读回存储。

```sh
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_direct_comparison \
  --arm direct --serial DEVICE_SERIAL --package com.alipay.hulu.trustbench --device-port 23343 \
  verify-run --plan solopi-harness-cli/trustbench/agent-notes-v3-paced30-long-v1.plan.json \
  --decision-provider cloud --cloud-endpoint http://127.0.0.1:18765/decide \
  --cloud-timeout 95 --restart-app --artifacts /new/direct-run
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_notes_storage \
  --run-dir /new/direct-run --serial DEVICE_SERIAL --apk /absolute/path/to/notes.apk
```

第二组仅替换 `--arm harness` 和新输出目录。plan 文件名保留历史 paced30 字样，
实际桥接间隔必须为 60000ms，不能依据文件名认定速率。
所有失败保留，不能用历史成功补齐本次配对。各组通过 `evaluate_attempt` 独立审计；
不要用忽略 arm 字段的旧 manifest 聚合器推导组间结果。

当前比较源码与历史 pilot 封存快照是不同版本；不覆盖旧源码校验清单。

## 2026-10-15 首次配对结果

机器可读审计：`direct-comparison-result-20261015-v1.json`。两个 runDir 和证据摘要分别保留在 attempts 中，不合并胜率。

| 组 | 外部结果 | 动作 / 有效模型决策 | 总耗时 |
|---|---|---|---|
| direct live-01 | UI、存储、证据审计通过 | 4 / 5 | 266.139 秒 |
| harness live-01 | provider_not_tested | 1 / 1 | 80.467 秒 |

Harness 第二次决策失败，桥接进程报告 HTTP 429；没有自动重试或替换模型。
模型提示、首次完整模型输入、计划和预算一致；成功收据的请求间隔配置均为 60000ms。
失败组未执行通过后的存储读回，所以审计中的 sameVerifiedDevice/sameVerifiedFixture 为 false，
表示缺少双组存储收据验证，不表示实际换了设备或 APK。
两次调用都指定 Redmi `REDACTED-DEVICE`，期间没有安装或切换设备。
本次未形成两个完整结果，因此不能判断 Harness 优于或劣于直接执行。
原有 pilot 收尾不等于核心增益实验完成；仍需服务恢复后的完整配对，以及预先规定的扰动对照。

新增运行证据合计约 1.43 MiB，未录屏、未采集全量日志。312 项单元测试通过。

本次运行源码 SHA-256：

- direct comparison：`b0c8831d1f08c2b342664f3c8c56285cdec3e390d0a8e43d0571136d19494d86`
- solopi_ai：`9007afec1a56032386d30c50699fb080b68d3533c98d2bdbbdb85b81eea839c3`
- 冻结协议：`3edea26570ef0d45133b253945068535e2cdd1984b223c7c121290e824636475`

## 2026-10-15 第二次配对：完整完成

用户授权重试后新建 direct/harness `live-02`，没有覆盖或补写第一次的结果。
机器可读审计：`direct-comparison-result-20261015-v2.json`。
源码及协议 SHA-256 与上列一致，使用同一桥接进程串行执行两组，所有 10 条成功模型收据
均记录 `minRequestIntervalMs=60000`，未发生 fallback，桥接进程结束时没有 429 输出。

| 组 | UI / 独立存储 / 证据审计 | 动作 / 模型决策 | 总耗时 | 输入 / 输出 token |
|---|---|---|---|---|
| direct live-02 | 全部通过 | 4 / 5 | 262.821 秒 | 2606 / 650 |
| harness live-02 | 全部通过 | 4 / 5 | 262.720 秒 | 2606 / 650 |

两组分别核验 8 个证据文件、2 个执行段；首次完整模型输入、提示词、计划、预算、
存储收据中的设备与 fixture APK 全部一致。每组 UI 通过后立即读取存储，未跨组借用收据。
新增运行目录分别约 900 KiB、880 KiB，合计约 1.74 MiB；未采集全量日志和录像。
模型桥接进程已关闭。

结论：本次正常任务配对已完成，未观察到任务完成率、动作数或 token 消耗上的差异。
0.101 秒耗时差不构成速度优势证据，尤其总耗时受一分钟限速主导。
不能据此声称 Harness 普遍更好，也不能声称两者统计等价。
核心增益问题仍需预先冻结的扰动对照和重复测量，本次没有擅自扩展到这些实验。
第一次 provider_not_tested 记录继续保留，不纳入任务失败，也不从尝试历史中删除。
