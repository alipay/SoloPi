# 自愿 Star 提醒

SoloPi 可在累计前台使用 30 分钟后，邀请用户为项目点 Star。所有功能始终可用，不需要 GitHub 登录，也不查询用户是否真正点了 Star。

## 行为

- 仅在首页有焦点、无活动执行会话或维护操作、连续空闲 3 秒时展示。
- 录制、回放、Agent 等通过 `RuntimeSessionGuard` 登记的会话会阻止提醒；检测到任务后再等至少 2 分钟。
- 应用退到后台不计时。使用单调时钟，每分钟及暂停时保存本地累计时间；异常终止可能丢失最后一段未落盘时间。
- 更新提示、崩溃提示优先，当次进程不再自动提醒。
- “稍后再说”、返回或点外部关闭：再累计 5 小时前台使用，并在后续进程中最多再提醒一次。每个进程最多一次，本地记录最多两次。
- “去 GitHub 点 Star”或“已 Star / 不再提醒”后停止自动提醒。不将打开链接记为真实 Star；未点赞的用户同样可以选择不再提醒。
- 关于页面保留主动访问仓库入口。
- 无网络统计、身份采集或上报；清除应用数据或卸载会重置本地记录。

自动提醒默认 release 开启、debug 关闭。构建参数 `-PsolopiStarPrompt=false` 可明确关闭，`-PsolopiStarPrompt=true` 可在调试构建开启。关闭时不自动计时或读取提醒记录；关于入口仍可打开仓库。

## 边界与验证

控制器通过 Activity 生命周期和每秒轮询检查运行状态，不持有执行锁，避免提醒反过来阻塞自动化。未登记到运行守卫的外部操作不在保护范围内。任务恰好与弹窗同时启动时，下一次轮询会关闭弹窗，不能声称绝对无瞬间干扰。

`StarPromptPolicyTest` 覆盖前台累计、阈值、空闲、后台排除、执行冷却、重启恢复、延期和永久关闭。真机验收还应确认首页弹窗保持可见、三个按钮与系统返回、后台恢复、更新通知优先，以及录制/回放时不出现提醒。不要用缩短正式阈值的版本发布。

## 参考

行为调研参考 [dsh-Go 的设计说明](https://github.com/ccch1mneyyy/dsh-Go/blob/HEAD/docs/design/star-prompt.md) 和 `app/lib/state/star_prompt.dart`。该项目采用 AGPL-3.0；本实现为独立 Java/Android 实现，未复制其源码、插图或文案。

## 本次验证记录（2026-11-04）

- 使用 JDK 11 和 JUnit 4.13.2 独立编译运行策略测试，9/9 通过。
- 完整 Debug APK 构建成功：从华为云 Gradle 镜像取得 6.1.1，并与官方 SHA-256 `9d94e6e4a28ad328072ef6e56bce79a810494ae756751fdcedffdeaf27c093b1` 核对一致，使用 JDK 11 完成构建。
- `:app:testDebugUnitTest` 共执行 198 项测试，0 failures、0 errors，其中新增提醒策略测试 9 项。
- APK 位于 `solopi-app/portal/build/outputs/apk/debug/portal-debug.apk`，隔离包名 `com.alipay.hulu.fastpath`，自动提醒开启，正式 30 分钟阈值未缩短。
- 已在连接的 Android 设备安装并预览圆角卡片弹窗，确认标题、正文和三个操作正常展示。预览通过修改调试应用的本地累计时长触发，不修改正式阈值。尚未完成完整真机行为验收（实际等待、按钮跳转、执行中冷却等）。
- 构建命令：在 `solopi-app` 使用 Gradle 6.1.1 运行 `gradle :app:testDebugUnitTest :portal:assembleDebug -PfastpathDebug -PsolopiStarPrompt=true`。后续按前述真机清单验收。
