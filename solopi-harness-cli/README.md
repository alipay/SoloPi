# SoloPi Harness CLI

最新主张与验证：[三方执行安全对照](trustbench/CONTRACT-THREEWAY-RESULTS-20261019.md)，比较直接执行、完整页面拦截与动作契约，明确配置依赖和结论边界。

本模块承载 SoloPi AI Harness 的宿主机控制面，包括设备协议客户端、动态 Agent
会话、验证计划、托管设备池、模型部署和统一证据输出。仓库内直接使用：

```bash
./solopi-harness-cli/solopi-ai --pretty doctor
```

运行单元测试：

```bash
python3 -m unittest discover -s solopi-harness-cli/tests -v
```

本目录保留 TrustBench 历史实验使用的 CLI。上游现行 Agent 入口位于 `solopi-skill/scripts/harness`，两者分别测试、分别维护；本次新增动作契约的命令请使用本目录入口。版本范围见 [发布说明](trustbench/RELEASE-20261021.md)。

首版可信验证基准合同与离线评分入口见 [SoloPi TrustBench v0 pilot](trustbench/README.md)。

当前交付入口：[安装、构建、模型配置和证据迁移审计](trustbench/REPRODUCE.md)。
最新实验：[动作安全 v2](trustbench/SAFETY-V2.md)、[可验证副作用](trustbench/EFFECTS-RESULTS.md)。
扩展实验及反例见 [coverage-v1](trustbench/COVERAGE-RESULTS.md)；后续修复见
[严格上下文验证](trustbench/REPAIR-RESULTS-20261019.md)和[动作契约 v1](trustbench/ACTION-CONTRACT.md)。
最新[冻结契约后的新场景配对验证](trustbench/CONTRACT-TRANSFER-RESULTS-20261019.md)完成 24 条执行、12 对，单独记录原始证据及结论边界。
直接从仓库运行无需 Codex、pip 安装或作者本机配置；真机运行仍需 Android 工具链与本人授权，模型实验需自备合法 API 凭据。
