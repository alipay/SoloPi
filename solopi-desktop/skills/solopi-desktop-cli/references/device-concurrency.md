# 显式SN与多任务

## 按实际设备互斥执行

- 外部提交任务直接指定手机 SN 和眼镜 SN：`solopi-desktop run task --case-id <CASE_ID> --phone <PHONE_SN> --glasses <GLASSES_SN> --json`。单用例也可用 `run case <CASE_ID>` 搭配相同参数；只需一端时仅传对应端。先用 `devices list --json` 核对本次在线设备，不从历史记录猜 SN。
- 同一个 Broker 允许设备集合互不重叠的任务并行；任一实际 SN 重叠就返回 `TEST_TASK_BUSY`，包含 `activeTask`、`activeTasks` 和 `conflictingDevices`。手机和眼镜角色不同也不能共用同一物理设备。占用覆盖待启动、运行、停止和全部日志/录屏/进程收尾。
- 显式 SN 覆盖本次执行副本中的用例默认 SN，不修改库内用例；省略端仍使用用例默认设备，因此省略参数不代表没有占用。回执 `reservedDeviceSerials` 给出本任务完整占用集合（包括性能目标）。性能采样与本次指定端必须使用相同 SN，否则拒绝提交。
- 每个成功提交保存各自的 taskId，分别用 `tasks show <taskId> --json`、`tasks watch <taskId> --jsonl` 跟踪。已知 taskId 不重复提交。桌面 Agent 未指定 SN 时使用当前头部所选设备，显式指定 SN 优先；头部未选择或离线应在提交前报错，不为运行单次任务要求改写全局绑定。不要把历史 SN 抄作显式参数。Agent 工具 `submit_task` 使用 `devices:{phone:{serial:PHONE_SN},glasses:{serial:GLASSES_SN}}`。
- 收到 `TEST_TASK_BUSY` 仅查询/订阅占用任务，等待收尾或按用户授权显式停止；不循环提交，不通过另开实例、隔离数据目录、改变会话或手工 ADB 执行用例绕过。旧版本全局拒绝并行时先升级，不靠额外进程绕过。
- Docker/远程 ADB 路由必须支持本次显式 SN。若设备不可用或适配器不支持，报告配置错误并修复路由；禁止把用例步骤改成手工 push、广播或 shell 执行来替代平台任务。框架锁只仲裁本 Broker，不能保证其他平台未占用同一设备。
