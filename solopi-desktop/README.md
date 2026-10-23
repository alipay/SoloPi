# solopi-desktop

**面向 AI 眼镜与穿戴设备的自动化测试工作台。**

solopi-desktop 帮助设备厂商、应用开发者和测试团队，把眼镜、配套手机和电脑上的测试步骤组织成可重复执行的用例，并集中查看执行结果与失败证据。

你可以在桌面端编排流程，用 CLI 批量运行已有用例，或让 AI Agent 通过同一套 CLI 执行测试、读取报告。已有电脑脚本也能配置成快捷操作，不必为每个团队重新开发一套界面。

[快速开始](#快速开始) · [第一个测试](#第一个测试) · [CLI 指南](docs/agent/glassbox-cli-usage.md) · [配置说明](docs/configuration.md)

## 它能帮你做什么？

眼镜测试通常不只发生在一个屏幕上：手机发起操作、眼镜响应、电脑收集日志，最后还要把这些信息拼起来判断是否通过。solopi-desktop 将这些工作放进同一个流程：

- **把多端操作串成用例。** 通过可视化流程组织设备命令、电脑脚本、HTTP 请求、输入和断言，明确每一步在哪台设备上执行。
- **把重复脚本变成按钮。** 配置脚本参数的名称、默认值、下拉选项或文件路径，让使用者填写必要信息即可执行；支持查询后操作、开始/结束型操作。
- **让测试资产可以协作。** 通过 Git 管理用例与快捷操作脚本，复用团队已有资产，而不是传递散落的命令和文件。
- **让失败可以复盘。** 查看步骤状态、耗时和错误；结合实际启用的日志、截图、录屏及报告定位问题，而不只看到“执行失败”。

例如，你可以编排“手机触发操作 → 等待眼镜响应 → 检查日志中的目标文本 → 保存结果”。具体业务指令、日志规则和设备适配由使用者配置，solopi-desktop 不替代厂商 SDK，也不能绕过设备权限。

## 快速开始

下面以 **macOS Apple Silicon + Android/ADB 设备** 为起点。这是当前主要发行验证组合，不代表所有桌面系统和穿戴设备都已验证可用。

### 1. 准备环境

- 已取得本仓库源码，电脑安装 Node.js、npm 和 Git。本次文档校验使用 Node.js 22.14.0；其他版本需验证依赖兼容性。
- 安装 Android SDK Platform-Tools，确保终端可以执行 `adb`。
- 设备开启 USB 调试，并允许当前电脑的调试授权。部分厂商固件需要额外开放 ADB 或应用调试权限。
- 使用 Git LFS 管理素材的仓库，还需要可用的 Git LFS。私有仓库需要使用者自己的访问权限。

### 2. 从源码启动

进入仓库内的 `solopi-desktop/` 目录执行：

```bash
cd solopi-desktop
npm ci
npm run dev
```

这会启动本地前端和 Electron 桌面窗口，不是只启动一个网页。不要将普通浏览器中的开发页面当作完整桌面客户端使用。

本仓库不是通过 `npm install solopi-desktop` 安装的公共 npm 产品；请使用源码或维护者提供的正式发行包。

### 3. 连接设备

```bash
adb devices -l
npm run solopi-desktop -- devices list --json
```

设备应显示为 `device`。如果显示 `unauthorized`，先在设备上确认授权；如果是 `offline`，先检查连接和 ADB 状态。

在顶部选择手机和/或眼镜的 SN。只操作一端的用例不必连接另一端；涉及应用的用例还需选择实际安装的包名。

### 4. 运行并看结果

在“自动化 → 用例库”中新建用例，按下面的只读示例添加步骤、保存并运行。完成后到“测试任务”查看该次运行的步骤详情与报告。先跑通这个最小链路，再接入自己的业务脚本与断言。

## 第一个测试

**目标：检查 Android 设备是否完成启动。** 这个例子只读取系统属性，不写配置、不安装应用、不触发支付，也不需要 root。

1. 在用例编辑器添加一个“通用 ADB 命令”节点，目标设备选择已连接的手机或眼镜。
2. 将开始节点、该命令节点和结束节点连接起来。
3. 在命令输入框填写以下完整命令，超时设置为 10 秒，然后保存、运行。

```bash
adb -s {{serial}} shell 'state=$(getprop sys.boot_completed); echo "sys.boot_completed=$state"; test "$state" = "1"'
```

`{{serial}}` 是 solopi-desktop 的变量，执行时使用该节点所选设备的 SN；它不是终端 Shell 的变量。直接在终端试验时，将它替换成 `adb devices -l` 返回的实际 SN。

**如何判断结果：**

- 输出 `sys.boot_completed=1`，且命令退出码为 0：本次检查通过。
- 属性为空或不是 `1`：`test` 返回非零退出码，本次检查失败。
- 设备断连、未授权或超过 10 秒：查看失败步骤的错误信息，先解决连接或执行问题。

这里的通过依据是“读取到的系统属性等于 1”，而不是“成功发送了一条 ADB 命令”。它只证明系统报告启动完成，不证明某个应用或眼镜业务已经就绪。

在任务详情中检查该步骤的输出、状态和耗时。截图、录屏等证据需要相应采集能力和选项；本示例不要求开启，也不保证每次运行都有这些附件。本文已核对命令形式与 CLI 入口，未在真实设备上执行此示例。

## 桌面端、CLI 与 Agent

| 入口 | 适合什么工作 |
| --- | --- |
| 桌面端 | 选择设备、编排流程、配置快捷操作、运行用例、查看报告 |
| CLI | 查询资产、运行已有用例或批量任务、追踪状态、读取结构化结果 |
| AI Agent | 调用 CLI 校验和执行用例，再根据报告分析结果；设备操作仍由执行引擎完成 |

源码目录下常用命令：

```bash
# 查看帮助和环境诊断
npm run solopi-desktop -- --help
npm run solopi-desktop -- doctor --json

# 找到已有用例，取得 caseId
npm run solopi-desktop -- cases list --json

# 将 YOUR_CASE_ID / YOUR_DEVICE_SN 替换为实际值
npm run solopi-desktop -- run case YOUR_CASE_ID --phone YOUR_DEVICE_SN --json

# 使用返回的 taskId 查看报告
npm run solopi-desktop -- reports show YOUR_TASK_ID --json
```

眼镜设备使用 `--glasses` 指定 SN；双端用例可以同时指定 `--phone` 和 `--glasses`。用例中的业务断言仍须自己配置，CLI 成功提交任务不等于测试通过。

Agent 需要纯 JSON 输出时，可用 `npm run --silent solopi-desktop -- ...` 避免 npm 的脚本提示混入输出。批量任务、状态订阅和报告导出详见 [CLI 指南](docs/agent/glassbox-cli-usage.md)。

## 按需扩展测试能力

| 能力 | 使用方式与边界 |
| --- | --- |
| 脚本快捷操作 | 从本地或 Git 管理脚本，在设置页配置参数表单和顶部展示；依赖电脑上的解释器、工具和权限 |
| 查询与开始/结束操作 | 配置查询结果展示、操作参数或开始/结束流程；查询脚本应保持只读 |
| 语音、图片与接口输入 | 通过相应组件或脚本接入；输入注入可能依赖厂商调试接口或设备适配 |
| 日志与结果断言 | 按目标文本、JSON 等规则验证实际响应；规则需要对应应用和设备的日志格式 |
| 截图、录屏与性能采样 | 为复盘保留证据；支持情况取决于设备、授权及是否启用采集 |
| 常用站点 | 配置团队网站并快速切换，共用应用内网页会话；各网站仍需自己的访问权限 |

## 支持范围与安全边界

- **当前主要验证范围：** macOS Apple Silicon 桌面发行与 Android/ADB 设备链路。不同型号和固件仍需验证，能够被 ADB 发现不代表支持所有测试能力。
- **其他平台：** Windows、Linux、iOS、鸿蒙及其他眼镜系统属于扩展方向，不能仅凭已有入口或脚本格式认定完整支持。
- **脚本不是沙箱：** 本机脚本以当前用户权限执行。只导入可信脚本与用例，执行前检查其设备写入、文件操作和网络访问行为。
- **外部服务按需配置：** 模型、语音合成等能力可能连接使用者配置的服务。发送测试数据前确认其数据处理规则；基础 ADB 检查不需要这些服务。
- **分享前脱敏：** 日志、截图、录屏和报告可能包含设备标识、账号、业务数据或令牌，不应直接作为公开反馈附件上传。

## 常见问题

**设备已经连接，为什么某个功能仍失败？**

USB/ADB 连通只是前提。功能还可能依赖应用安装、调试包、厂商授权或特定服务。先看失败步骤，不要把所有失败都归因于设备连接。

**已有 Shell 脚本，必须改成 solopi-desktop 专用格式吗？**

不必。脚本可以保持终端可执行，在设置页配置参数、默认值和输入控件。solopi-desktop 无法可靠猜出任意脚本的业务含义，请核对参数顺序和必填项。`{{phoneSerial}}`、`{{glassSerial}}` 等变量由应用解析，不是 Shell 原生语法。

**运行失败后从哪里排查？**

在“测试任务”打开本次运行，先定位失败步骤及其错误，再看实际生成的附件；CLI 可用 `reports show` 读取同一任务的结果。设备响应断言失败与命令执行失败是不同问题。

**为什么文件名、报告后缀或命令里仍有 GlassBox？**

solopi-desktop 原名 GlassBox。部分历史路径、协议标识、`.glassreport` 后缀和 `glassbox` 兼容入口仍保留，避免破坏已有资产；产品名称统一使用 solopi-desktop。

## 文档与贡献

- [配置说明](docs/configuration.md)：环境和功能配置。
- [CLI 指南](docs/agent/glassbox-cli-usage.md)：自动化调用与报告查询。

欢迎贡献可复现的问题、文档修正、脱敏用例和设备适配。反馈时请提供版本、主机系统、设备与固件、最小复现步骤、预期和实际结果，避免上传密钥或内部业务资料。准备贡献较大功能时，先与维护者确认范围及验证方式。

### 许可证

本项目是 SoloPi 的桌面补充工具，遵循 SoloPi 项目的 **Apache License 2.0** 开源协议，完整条款见 [LICENSE](LICENSE)。第三方组件的许可证与版权声明见 [NOTICE](NOTICE) 和 [第三方许可声明](THIRD_PARTY_NOTICES.md)。

公开源码范围和导出方法见 [公开源码说明](docs/public-source.md)。

### Existing installation compatibility

The public application, CLI and CLI Skill are named `solopi-desktop`.
New installations use that name for their data directory. Existing `Glass Box`
data directories are read in place so saved settings, tasks and reports remain
available. `SOLOPI_DESKTOP_DATA_DIR` selects an explicit data directory;
`GLASSBOX_CLI_DATA_DIR` and the previous CLI launcher remain compatible aliases.
Persisted schema identifiers, report protocols and the application update ID
remain stable. Internal compatibility identifiers are not public product names.

## SoloPi 操作记录

用例库新建菜单支持导入 SoloPi 历史用例和录制操作生成可编辑草稿。依赖、转换边界和 CLI 用法见 [SoloPi 导入与录制](docs/SOLOPI_IMPORT.md)。
