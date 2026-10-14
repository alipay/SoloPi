# SoloPi Skill 内置 Harness

本模块随 `solopi-skill` 分发，承载宿主机控制面，包括设备协议客户端、动态 Agent
会话、验证计划、托管设备池、模型部署和统一证据输出。仓库内使用统一入口：

```bash
./solopi-skill/scripts/solopi-ai --pretty doctor
```

运行单元测试：

```bash
python3 -m unittest discover -s solopi-skill/scripts/harness/tests -v
```

核心协议实现只在本目录维护。单独复制 Skill 时入口仍可运行，不需要安装同级模块。
开发者也可以在虚拟环境中执行 `python -m pip install -e ./solopi-skill/scripts/harness`；
Python 包名保持 `solopi-harness-cli`，命令仍为 `solopi-ai`。

## 连接手机后直接运行

手机停在已登录的支付宝首页，无键盘和弹窗。三个内置模板可直接选用，不需要手动准备计划文件：

```bash
./solopi-skill/scripts/solopi-ai --pretty workflow-list
./solopi-skill/scripts/solopi-ai --serial <adb-serial> --pretty workflow-run --template alipay-more-services
./solopi-skill/scripts/solopi-ai --pretty workflow-report --artifacts <上一步返回的artifacts>
```

可选模板：`alipay-more-services`（更多服务往返）、`alipay-education`（教育公益分类浏览）、
`alipay-settings`（设置页面查看）。自动完成预检、编译校验、执行和 Markdown 报告，保留每个执行段的原始整屏截图。
默认使用规则；Laya 通过 `--mode laya --model <本地MLX权重目录>` 显式启用，在电脑上运行。
Skill、Harness、APK 的分工、报告状态及故障处理见[使用说明](../../references/workflows.md)。

新版电脑回放只要求内部 ADB 与辅助功能，悬浮窗不再是前提，电池优化白名单仅作建议。详见[故障处理](../../references/troubleshooting.md)。

历史模型与真机对照移至仓库的 `docs/harness/fastpath`，未随运行包分发；其旧路径命令的对应关系见
`docs/harness/MIGRATION.md`。`verify-run` 支持同次运行内 HTTP keep-alive，以及显式启用的
`target-context-v1` 原生点击校验；默认仍检查完整页面，模型不能修改验收条件。
