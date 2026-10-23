# 经授权的隔离开发执行

仅适用于用户明确要求源码联调或开发修复→真实设备复验闭环；不是普通运行的默认降级方案。

1. 从开发交付确认源码仓库路径、修复版本与受支持入口。读取该版本 `docs/DEVELOPMENT_RUNNER.md`，核对 `scripts/solopi-desktop-dev.mjs` 存在；缺能力交开发，不自行拼 Electron 参数。
2. 使用 `prepare --source-data-dir <正式目录>（可选 --data-dir <全新隔离目录>） --case-id <id>` 复制最新用例和依赖。正式用例修复仍走受支持本地更新接口；修改后重新准备快照，不能复用旧快照。快照含本机配置，不上传共享库。
3. 经同一 wrapper 执行 `devices list --json`，沿用设备在线门禁。一次 `run task --case-id <id> --phone <SN> --glasses <SN> --stress-rounds <N> --json` 异步提交，保存唯一 taskId；用同一 dataDir 查询/停止。不要并行启动占用相同设备的正式任务。
4. 核对 ACK 中设备、包名、环境、validationSummary 与 executionProvenance（源码 hash、用例源版本）。发现平台问题交开发；运行中不修改执行源码，不因轮询超时重复提交。
5. 终态检查 completed/total、逐轮结果和唯一 `.glassreport`。任务完成不等于全部通过；业务失败与用例/平台错误分开说明。只修有证据的问题，不为通过放宽断言。

## 开发任务临时保存

显式开发快照不进入正式任务列表，不要求正式UI回补；普通正式CLI/UI任务仍按原规则同步。prepare省略 --data-dir 时使用系统临时目录，后续用返回的dataDir查询、停止与读取报告。开发标识来自executionProvenance.mode，不由名称判断。

终态任务默认保留7天，应用启动及每天一次清理；运行中不清理。历史开发来源按真实数据源分组，经所属Broker清理专属产物；不猜ID，不直接手改正式userData，也不递归删除旧工作目录。只有专属受管临时目录及所有权清单核验通过时才允许整目录到期回收。关闭应用时停止定时器及其尚未完成的所属清理请求。
