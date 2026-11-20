# 三端设备控制与录制用例回放

该入口从 alipay/SoloPi 的 e0c7752 导入，并适配本地任务、IPC、设备占用与打包链路。现有用例编辑器、Agent 和报告实现保留。

左侧“三端设备控制”可发现 Android、iOS、HarmonyOS NEXT 设备，读取页面、选择节点、录制操作与验收条件，并重复执行已录制用例。“录制用例回放”指按保存的步骤与预期执行，不由模型临时决定步骤。每次回放进入统一测试任务列表，使用同一 taskId 查看执行状态、停止和最终报告；应用重启只将中断记录落盘，不自动重放未知结果的动作。

## 依赖与使用

- 电脑需要 Python 3.9+；可通过 SOLOPI_HARNESS_PYTHON 指定解释器。开发源码位于 resources/device-harness，安装包中的资源目录为 harness；不依赖仓库外的相邻目录。
- Android 需要 ADB、已授权设备及支持对应控制协议的 SoloPi 手机构建。默认控制包 com.alipay.hulu，端口 23342；页面可配置。
- iOS 需要与设备匹配且已启动的 WebDriverAgent；默认端口 8100。NEXT 当前仅开放通过 HDC 连接的模拟器，不宣称真机已验收。
- 连接目标应用后，先刷新页面，再选择该次观察的节点执行操作。页面变化时使用新观察；结果未知时先核对证据，不重发点击。
- 录制中至少执行一步并添加固定验收条件，保存用例后可回放。执行证据保存在本地，页面提供打开证据目录的入口。

Agent 和外部 CLI 的平台工具共用 discover_device_control、device_control 的 schema 与实现。可通过现有 CLI tools list/describe 查询参数；调用沿用 requestId 回执与写操作授权机制。

## 验收范围

本批进行了隔离桥接、原生 Harness、生命周期、任务可见性和 Python 协议测试。没有在真实 Android/iOS/NEXT 设备上执行本批改动，也没有发布或安装新包。上游历史实测结果不等同于本地合入验收。
