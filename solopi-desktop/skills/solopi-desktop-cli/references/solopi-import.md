# SoloPi 历史用例与录制

用户要求导入 SoloPi 历史用例时，使用确定性转换命令，不手动改写源用例 JSON：

```sh
solopi-desktop cases import-solopi --file old-solopi-case.json --out new-desktop-case.json --json
solopi-desktop cases create --file new-desktop-case.json --library LIBRARY_ID --json
```

第一条仅生成新文件；第二条在用户指定的库内新增草稿。不能覆盖已有文件。`--phone SN` 可选，仅设置草稿默认设备。用例输入可以是 SoloPi 原用例或 `case-get` 完整 JSON 回执；外置操作记录须先由 SoloPi 正式导出。

检查 `operationCount`、`issues`、`runnable`，转换成功不代表业务通过。输入内容默认移除；暂不支持的操作保留为待处理节点并拦截执行，不能删除标记绕过。需要补齐定位、输入变量、控制流或断言时，在用户授权范围内编辑草稿。

新录制由桌面用例库的新建菜单「SoloPi 录制生成」触发。Desktop 内置录制控制和官方手机组件，自动沿用头部手机SN及被录制包名，用户不配置外部CLI/Python或组件包名；开始时自动检查并准备手机组件，必要手机系统授权由用户确认。当前 desktop CLI没有独立的 `record-start` / `record-stop` 公共命令，不要启动另一个Harness或手工ADB录制绕过设备租约。

启动/停止结果不明时恢复同一会话，不重复创建；已确认未分发到手机的前置失败不会保留录制占用。历史用例离线导入不要求连接设备或安装手机组件。
