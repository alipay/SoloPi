# SoloPi 动作目录

本目录以安卓端 `PerformActionEnum` 的 66 个枚举和当前源码注册的 6 个内置动态
ActionProvider 动作契约为准。后者由三个 Android `ActionProvider` 实现发布，并不
表示存在 6 个 Provider 实现。先运行 `actions` 读取离线编写契约，再编写用例；该
命令不扫描设备插件，动作出现在契约中不代表目标设备已经安装插件或满足运行条件。

`case-validate` 只校验结构与参数边界，不能证明节点、插件、权限或业务结果有效。优先从 `case-get` 克隆真实步骤，缺少基础用例时先用 `inspect` 获取真实节点，最后通过终态回放验证。

## 66 个安卓枚举

| 安卓分类 | 动作代码 |
|---|---|
| 节点操作（18） | `click`、`longClick`、`input`、`multiClick`、`clickIfExists`、`clickQuick`、`clickAndInput`、`inputSearch`、`scrollToBottom`、`scrollToTop`、`scrollToRight`、`scrollToLeft`、`gesture`、`assert`、`sleepUntil`、`otherNode`、`letNode`、`checkNode` |
| 应用操作（20） | `back`、`reload`、`handleAlert`、`jumpToPage`、`generateQrCode`、`generateBarCode`、`globalScrollToBottom`、`globalScrollToTop`、`globalScrollToRight`、`globalScrollToLeft`、`keyboardInput`、`globalPinchOut`、`globalPinchIn`、`globalGesture`、`goToIndex`、`clearData`、`assertToast`、`killProcess`、`sleep`、`executeShell` |
| 设备操作（9） | `inputGlobal`、`screenshot`、`home`、`notification`、`recentTask`、`deviceInfo`、`pause`、`resume`、`otherGlobal` |
| 流程操作（5） | `changeMode`、`finish`、`let`、`load`、`check` |
| 本地回放操作（2） | `forceStop`、`slaveExit` |
| 其他枚举（2） | `cancel`、`focus` |
| 内部控制（6） | `permissionAlert`、`inputMethod`、`while`、`if`、`continue`、`break` |
| 用例界面操作（4） | `deleteCase`、`exportCase`、`playMultiTimes`、`genMultiParam` |

少数动作代码与规范化枚举名差异较大：

| 动作代码 | 规范化枚举名 |
|---|---|
| `goToIndex` | `GOTO_INDEX` |
| `load` | `LOAD_PARAM` |
| `slaveExit` | `NORMAL_EXIT` |
| `permissionAlert` | `HANDLE_PERMISSION_ALERT` |
| `inputMethod` | `HIDE_INPUT_METHOD` |

其他动作通常按大写下划线形式规范化，例如 `clickIfExists` 转为 `CLICK_IF_EXISTS`。

### 不作为普通回放步骤的动作

以下 4 个枚举是用例列表界面的生命周期或管理动作，不得写进普通 `operationLog.steps`，应使用对应 CLI：

| 安卓枚举 | CLI 能力 |
|---|---|
| `DELETE_CASE` | `case-delete` |
| `EXPORT_CASE` | `case-get` |
| `PLAY_MULTI_TIMES` | `run-repeat` |
| `GEN_MULTI_PARAM` | `case-get` -> `case-validate --running-params-file` -> `case-import --replace` |

`GEN_MULTI_PARAM` 配置的是单个用例 `advanceSettings.runningParam` 中的 `SEPARATE` 或 `UNION` 参数集合。它与按顺序运行多个用例名的 `run-batch` 不等价。参数文件必须是只包含 `mode` 和非空 `paramList` 的 JSON 对象；先输出新的导入文件并检查差异，再明确替换准确用例。

以下 7 个录制、远控或回放界面控制动作不会进入普通回放执行路径，不得写入普通用例：`CANCEL`、`FOCUS`、`FINISH`、`PAUSE`、`RESUME`、`FORCE_STOP`、`NORMAL_EXIT`。需要取消 CLI 启动的回放时使用顶层 `cancel` 命令；不要把这些安卓枚举当成等价步骤。

`HANDLE_PERMISSION_ALERT`、`HIDE_INPUT_METHOD` 是源码明确标记为“不对外”的内部运行时动作；前者可能自动点击系统权限按钮。已有用例中只能通过 `case-step-list` 查看，CLI 固定拒绝新增、更新、复制、校验、导入和回放。

`WHILE`、`IF`、`CONTINUE`、`BREAK` 由步骤执行器处理，可保留或编写为带上下文的逻辑步骤。优先克隆 `case-get` 导出的真实结构，并通过 `case-validate` 和真机终态回放验证。

`EXECUTE_SHELL` 虽是安卓历史枚举，但 SoloPi Skill 不提供任意 Shell 直通能力，也不指导创建该步骤。已有用例中的该动作只能通过 `case-step-list` 查看；`case-validate`、`case-import` 和所有 `run*` 命令固定拒绝，不得复制到新用例，也不得借它绕过类型化 CLI。

## 节点与参数边界

节点类步骤必须提供 `operationNode`，并至少包含一个来自 `inspect` 或 `case-get` 的非空选择器字段：`resourceId`、`text`、`description`、`xpath` 或 `id`。不得猜测选择器，也不得跨应用直接复用。

| 动作代码 | 必填参数 |
|---|---|
| `input`、`inputSearch`、`clickAndInput`、`keyboardInput` | `text` |
| `longClick`、`multiClick`、`sleepUntil` | `text` |
| `sleep`、`screenshot` | `text` |
| `inputGlobal` | `text` |
| `jumpToPage`、`generateQrCode`、`generateBarCode` | `scheme` |
| `assert`、`assertToast` | `assertMode`、`assertInputContent` |
| `gesture`、`globalGesture` | `gesturePath`、`gestureFilter` |

CLI 会把数字和布尔参数规范化为字符串。未列出的运行时参数应从真实用例复制，不得自行发明字段。

## 6 个动态 ActionProvider 动作

动态动作不在 66 个枚举中。性能与录屏动作通过 `OTHER_GLOBAL` 承载；两个图片动作通过 `OTHER_NODE` 承载并要求真实 `operationNode`。所有动态动作的 `operationParam.targetAction` 都必填；`targetActionDesc` 仅是展示文本，不能代替 `targetAction`。

这里的 ActionProvider 属于 Android 固定用例回放扩展点，负责定义“设备如何执行
某类动作”。它不同于 AI 验证控制层的 `DecisionProvider`：DecisionProvider 只在
首帧 observation 和每个 settled observation 后输出下一步 Action Proposal，没有
设备执行权或 Result Judge 裁决权；其动态 proposal 只能落到 `click`、
`longClick`、`input`、`back`、`home`、`scroll`、`wait` 七种 typed action，不能
直接提议本节 6 个 ActionProvider 动作。

| `targetAction` | 用途 | 必填参数与边界 |
|---|---|---|
| `startRecord` | 在用例步骤中开始性能记录 | `checkList`：非空、英文逗号分隔的当前设备指标名；先用 `perf-list` 获取。不得填写 `url`，避免上传数据。 |
| `stopRecord` | 停止与前一步配对的性能记录 | 除 `targetAction` 外无必填参数；必须与本次用例中的 `startRecord` 成对并放入清理路径。 |
| `startRecordScreen` | 开始录屏并计算响应耗时 | `resolution`、`INTENT_VIDEO_BITRATE`、`INTENT_FRAME_RATE`、`INTENT_EXCEPT_DIFF` 必填。分辨率格式为 `宽x高`；码率为正整数千比特每秒；帧率为正整数；差异阈值为正数。不得填写上传 `url` 或 `title`。要求安卓 5.0 及以上、录屏授权和对应插件。 |
| `stopRecordScreen` | 停止与前一步配对的录屏 | 除 `targetAction` 外无必填参数；必须与本次用例中的 `startRecordScreen` 成对。 |
| `clickByScreenshot` | 按模板图定位并点击 | 使用 `OTHER_NODE` 并提供真实节点；`targetImage`：非空 Base64 图片；`originSize` 可选，格式为 `宽,高`；`originPos` 仅作为裁剪元数据。要求图像对比插件。 |
| `assertScreenshot` | 断言模板图存在 | 使用 `OTHER_NODE` 并提供真实节点；其余参数与 `clickByScreenshot` 相同；图片内容按敏感测试数据处理。 |

Provider 的可用性随设备、插件、权限和状态变化，例如性能或录屏开始后才可执行相应停止动作。Provider 上传 URL 固定拒绝；图片对比和录屏插件必须先通过用户指定的本地 ZIP 安装并重启加载，回放执行路径不会从服务器自动下载。`actions` 只列出内置编写契约，不会发现插件额外注册的 Provider；仍要通过 `doctor`、`plugin-list`、相关状态命令和真机回放确认。

## 高风险边界

- `clearData` 会清除目标应用数据；`killProcess`、`forceStop` 会停止进程或应用；执行前必须得到用户对设备、应用和影响范围的明确授权。
- `jumpToPage` 会打开深链或外部页面；二维码、条码、输入、截图模板可能包含账号、凭据、支付码或交易数据，按敏感数据处理。
- 不得把秘密写入用例 JSON、命令行参数、截图名称或证据目录。
- 动作级 `screenshot` 是用例步骤；顶层 `screenshot` 命令是独立取证。动作级 `cancel` 不得用于替代顶层运行取消。
