# 端侧 Agent 模型部署

本能力使用独立 `com.alipay.hulu.agentmodel` companion 承载 ExecuTorch 1.4.0，
SoloPi 本体仍只负责受约束观察、typed action、settle、租约和证据。当前仓库
验证基线是 CPU/XNNPACK；GPU/NPU 不可用不会改变模型语义，也不会触发任意后端
加载。这是 Counter 离散策略的端侧模型工程链路验证，不等同于通用 GUI 模型已
达到生产质量或已在支付宝等真实 App 上完成端侧决策验证。

## 签名包

目录固定包含 `manifest.json`、`manifest.sig` 和 `model.pte`。清单 schema 是
`solopi.ai.model-manifest/v1`，签名是对清单原始字节的 detached
`SHA256withRSA`。安装前主机与 Android companion 都核对 trusted `keyId`、签名、
模型 SHA-256/大小、ExecuTorch 版本、backend、API、ABI 和 CPU 能力；任一失败均
不改变已安装或活动版本。仓库只保存 PoC 公钥，不保存私钥。

```bash
scripts/solopi-ai --pretty model-verify \
  --package examples/executorch-counter-policy --api-level 35 --abi arm64-v8a
scripts/solopi-ai --pretty model-install \
  --package examples/executorch-counter-policy
scripts/solopi-ai --pretty model-activate \
  --model-id solopi-counter-add-policy --model-version 1.0.0
scripts/solopi-ai --pretty model-infer \
  --model-id solopi-counter-add-policy --inputs '[[0],[1]]'
```

安装通过 DUMP 保护的固定 staging URI 流式写入三种准确文件，然后由 companion
搬入 app-private version 目录；CLI 不暴露设备路径、任意 ContentProvider 方法或
Shell。激活和回滚都会重新核对 app-private 包的签名、身份、兼容性、大小与摘要，
再加载 `.pte`；真实加载成功后才交换 active/previous。安装提交后即使进程在状态
记录前退出，相同完整包仍可幂等恢复。

## 基准与发布门禁

`model-benchmark` 输出 cold/load、first decision、P50/P95、PSS memory、充电计数
可用时的 mAh delta，以及原始延迟样本。功耗计数不可用时返回 `null`，只有清单
明确 `powerRequired=false` 才能继续评估。

```bash
scripts/solopi-ai --pretty model-benchmark \
  --package examples/executorch-counter-policy \
  --model-id solopi-counter-add-policy --model-version 1.0.0 \
  --inputs '[[0],[1]]' --output /tmp/counter-benchmark.json
scripts/solopi-ai --pretty model-release-check \
  --package examples/executorch-counter-policy \
  --benchmark /tmp/counter-benchmark.json \
  --evaluation solopi-harness-cli/fixtures/model/counter-policy-evaluation.json
```

benchmark 使用 `solopi.ai.model-benchmark/v1`，必须绑定签名包 digest、model/version、
实际 runtime/backend 和 API/ABI/capability。evaluation 使用
`solopi.ai.model-evaluation/v1`，必须绑定同一 package digest、共享测试集 SHA-256，
并明确记录 cloud 与 on-device 均执行该语料。`model-release-check` 先验证这些绑定和
设备兼容性，再合并 `decisionAccuracy/taskSuccessRate` 并比较签名阈值。缺少绑定、
缺失必需指标、超阈值、低准确率或低任务成功率均 fail closed；指标不达标返回
`blocked` 和退出码 2，证据不可信返回退出码 3。

这些门禁证明指定签名包、设备、语料和阈值组合满足本次发布策略，不是跨模型、
跨设备或跨业务场景的通用“生产可用”认证。更换模型、backend、设备能力、语料
或阈值后必须重新采集和判定。

## 动态验证

`verify-run --decision-provider on-device --model-package <dir>` 在动态 segment 的
首帧 observation 到达后调用一次，并在每次动作产生新的 settled observation 后
再次调用端侧模型。`DecisionProvider` 只根据当前上下文输出 Action Proposal
（`act`、`done` 或 `blocked`）；它没有设备控制权、不能直接执行动作，也没有结果
裁决权。`act` 仍须经过动态协议白名单、当前 `observationId`、设备端执行和 settle；
`done` 只停止探索。验证引擎中的 Result Judge 是三态结果的唯一最终裁决主体，
只有它确认全部 checkpoint 的确定性 Oracle 和 required cleanup 通过，整体才为
`passed`。这里的 Oracle 是 checkpoint 的预期规则/字段，不是模型自评或数据库。

`--decision-provider cloud --cloud-endpoint <url>` 使用同一 typed provider 契约。
`--cloud-fallback-endpoint` 只捕获模型加载、companion 或推理基础设施错误；未知
输出、越权动作、产品失败和 Result Judge 的 `failed/not_tested` 不 fallback。
`not_tested` 可能来自前置条件、checkpoint 未到达、证据缺失或无法可靠归因，不能
笼统描述为 Oracle 失败。

离线 PoC 使用 `examples/executorch-counter-policy` 与
`solopi-harness-cli/fixtures/model/counter-offline-requirement.json`。该 add 模型只证明
真实 JNI 推理、生命周期、Action Proposal 和 Result Judge 闭环，不代表通用 GUI
模型质量、业务成功率或生产部署范围。
