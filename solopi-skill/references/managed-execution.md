# SoloPi 托管执行与设备池

本层把已有验证计划扩展为可无人值守运行的单机控制面。SQLite 只负责设备、
队列、调度、租约、恢复和汇总；真实 UI 操作仍由 `verify-run` 通过动态 Agent
协议和固定用例执行。验证引擎中的 Result Judge 是 `passed`、`failed`、
`not_tested` 的唯一最终裁决主体；Oracle 只是 checkpoint 内声明的确定性预期
规则和字段，不是数据库、模型或 Agent 的自我判断。

## 控制面边界

- 数据库使用 WAL 和事务式 claim，可由同一主机上的多个 worker 竞争；当前不
  提供多主机 active/active 共识。
- 每个 assignment 固定 `taskId + shardId + attemptId + deviceId + leaseId +
  ownerGeneration`。任何字段不一致或 generation 过期都拒绝 heartbeat、结果提交
  和设备释放。
- 任务提交由 `idempotencyKey` 和完整执行内容指纹去重。首次提交返回
  `ownerToken`；后续重复提交和取消都必须持有同一 token。
- 基础设施失败可按上限和指数退避重试；Result Judge 产出的 `failed/not_tested`
  不自动重跑。两者都是验证终态，不能笼统称为“Oracle 失败”；连续设备故障会
  暂时打开 circuit breaker。
- task 和 shard 终态不可逆。旧 worker 最多完成已经发出的物理动作，不能把
  迟到结果写入 successor 的报告。
- Android 端动态 Agent `sessionId` 只标识一次 App 进程内会话，应用重启后不可
  作为恢复依据；主机侧持久保存的是 task、shard、attempt、事件和证据索引。
  Worker B 不继承 Worker A 的内存、调用栈或 Android session，而是重新 claim
  持久 shard，读取提交时持久化的 plan、decisions 和目标 serial，以新 attempt 从
  测试入口重新运行。A 的旧 events/evidence 只用于审计，不作为续跑现场。
- `ownerGeneration` fencing 保证旧 Worker 的 heartbeat、提交和释放不能污染新
  assignment，但不承诺真实 UI 触摸的物理副作用 exactly-once。A 失联前发出的
  点击仍可能已经生效；新 attempt 必须重新执行计划的前置检查、观察和判定，
  不能从 A 的最后一步续跑或把旧证据当作当前结果。

## 设备与提交

```bash
scripts/solopi-ai --pretty managed-init --database artifacts/managed.sqlite
scripts/solopi-ai --serial '<adb-serial>' --pretty managed-device-probe \
  --database artifacts/managed.sqlite \
  --device-id pixel-8 \
  --label tier=physical
scripts/solopi-ai --pretty managed-submit \
  --database artifacts/managed.sqlite \
  --plan artifacts/counter.plan.json \
  --matrix requirements/android-matrix.json \
  --idempotency-key '<ci-build-id>' \
  --owner-token '<ci-secret>'
```

矩阵是 1 到 64 个展开 shard 的数组。每个 target 可使用 `deviceIds`、`serials`、
`platform`、`minApiLevel/maxApiLevel`、`capabilities` 和 `labels` 选择设备，并可用
`replicas` 要求多个独立 assignment。`managed-device-probe` 会运行实际 doctor；
未完全就绪的设备以 `degraded` 注册，调度器不会选择它。

## 工作节点与持续集成

```bash
scripts/solopi-ai --pretty managed-worker-loop \
  --database artifacts/managed.sqlite \
  --worker-id worker-local-1 \
  --artifacts-root artifacts/managed-runs \
  --max-idle-polls 30
scripts/solopi-ai --pretty managed-report \
  --database artifacts/managed.sqlite \
  --task-id '<taskId>' \
  --output artifacts/managed-report.json
```

`managed-worker-once` 适合 CI job，`managed-worker-loop` 适合常驻单机 worker。
worker 在执行中续租，只为 assignment 的准确 serial 创建 `AdbClient`，并直接
调用现有 `verify-run`。报告稳定退出码为：`0 passed`、`2 failed`、
`3 not_tested`、`4 非终态/控制错误`、`130 cancelled`。

服务重启后先执行 `managed-recover`，或直接启动 worker；claim 会自动回收过期
租约。网络/ADB 中断进入有界重试，取消使用：

```bash
scripts/solopi-ai --pretty managed-cancel \
  --database artifacts/managed.sqlite \
  --task-id '<taskId>' \
  --owner-token '<original-owner-token>'
```

## HTTP 接口

```bash
scripts/solopi-ai managed-serve \
  --database artifacts/managed.sqlite \
  --bearer-token '<service-secret>' \
  --bind 127.0.0.1 --port 8765
```

服务只允许 loopback。`/health` 是无凭据就绪探针；其他资源都要求
`Authorization: Bearer <service-secret>`：

- `GET/POST /v1/devices`；
- `POST /v1/tasks`，`GET /v1/tasks/{taskId}`；
- `GET /v1/tasks/{taskId}/events?after=<sequence>`；
- `GET /v1/tasks/{taskId}/report`；
- `POST /v1/tasks/{taskId}/cancel`，body 含任务 `ownerToken`；
- `POST /v1/recover`，body 为 `{}`。

JSON body 上限为 1 MiB。Bearer、owner token、cookie、password 和 API secret
不会进入事件或持久报告。HTTP API 不执行 worker，也不暴露 ADB、Shell、原始
Scheme 或设备端控制端口。

## 报告与保留

`managed-events` 按任务内连续序号返回 append-only 事件。汇总报告保留每个
target/replica 的设备、attempt、failure category、验证 outcome fingerprint、
证据路径和 digest。达到 `retentionMs` 后，控制面可标记原始证据已清理，但仍
保留 digest、checkpoint/Result Judge 结果和 assignment receipt，用于证明执行链路。

报告结论必须沿同一次执行的身份链反向定位：

```text
planFingerprint
  -> taskId / shardId / attemptId
  -> sessionId / observationId / stepId
  -> typed receipt / settled observation
  -> append-only timeline
  -> checkpoint / cleanup
  -> Result Judge
  -> report / evidence digest
```

不能把上一 attempt、另一 Worker 或独立性能会话的截图和数据补进本次结论。
`outcomeFingerprint` 只规范化摘要同一计划的裁决状态，便于比较两次结果是否一致；
它排除时间、run ID 和本机路径，也不包含完整证据来源，因此不能替代上述
same-run identity chain，更不能单独证明两份证据来自同一次运行。
