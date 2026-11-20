# 通用任务合同

本页仅适用于独立 `solopi-lab` 调度客户端；提供 `/v1/lab/*` 的 Node Server 使用公用 `solopi-lab-task-ops` Skill 的 Server HTTP 合同，无需额外启动本页的协调器。当前客户端支持 call/mcp/coordinator/node。根据用户指定或宿主配置定位 CLI，不扫描旧包，也不把安装 Skill 当作安装服务。

读取 `SOLOPI_LAB_CLIENT_CONFIG` 指定的配置路径；未设置时检查 `$HOME/.config/solopi-lab/client.json`。不要打印配置中的凭据。

```sh
solopi-lab --config /absolute/path/client.json call health
solopi-lab --config /absolute/path/client.json call resources
```

路径是参数形状，须替换为已确认的本机配置；设备在线、可用范围和占用以实时 resources 为准。

## 最小提交

将以下形状保存为 request.json；请求标识及用例 ID 必须取自当前任务，不能照抄：

```json
{
  "requestId": "stable-logical-request-id",
  "caseIds": ["existing-case-id"]
}
```

```sh
solopi-lab --config /absolute/path/client.json call submit --file request.json
```

可选字段：taskName、requirements、options、source、target。requirements 对 nodeId/groupId 或组属性精确匹配；设备由调度租约提供，不能在 options 中强换设备。options 使用当前执行器支持的 startOptions、performanceOptions、stress 等参数；stress.mode 为 rounds/duration，value 为用户指定的正整数。

source 是可省略的关联对象，例如 `{"client":"cli","correlationId":"original-request-id"}`。仅在有已配置且获授权的通知目标时传 target，并满足该目标声明的来源条件。来源信息不替代身份鉴权。不配置 source/target 仍能提交、查询和停止。

同 requestId 同内容返回同一任务；REQUEST_CONFLICT 要读原请求而不是换 ID。返回 id 是调度 jobId，task_id 是实际执行器 taskId，二者不可互换。资源忙时可保持 queued，不据此另建请求。

## 查询、停止与产物

保存 `{"jobId":"实际返回的id"}` 为 job.json，再按需调用：

```sh
solopi-lab --config /absolute/path/client.json call status --file job.json
solopi-lab --config /absolute/path/client.json call stop --file job.json
solopi-lab --config /absolute/path/client.json call artifacts --file job.json
```

list 支持 after/limit 分页并返回 nextAfter。stop_requested 不等于已停止；needs_reconciliation 保留占用，需维护者取证后恢复，不通过改库或按时间强制释放。

下载只使用 artifacts 返回的 downloadPath，并使用新的本地输出文件：

```sh
solopi-lab --config /absolute/path/client.json download /v1/artifacts/returned-id --output /absolute/new/file
```

下载成功不证明测试通过。按报告中的原 taskId、caseId 和序号读取证据，不能拿本地不可达路径冒充可下载产物。没有生成或未上传的产物明确说明缺失。
