# SoloPi Harness CLI

本模块承载 SoloPi AI Harness 的宿主机控制面，包括设备协议客户端、动态 Agent
会话、验证计划、托管设备池、模型部署和统一证据输出。仓库内直接使用：

```bash
./solopi-harness-cli/solopi-ai --pretty doctor
```

运行单元测试：

```bash
python3 -m unittest discover -s solopi-harness-cli/tests -v
```

`solopi-skill` 是面向 Agent 的适配层；核心协议实现只在本模块维护。
