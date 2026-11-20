# Lab Server 原生 HTTP 使用

适用于提供 `/v1/lab/*` 的 Node Lab Server。独立 `solopi-lab` 调度客户端的 `/v1/submit` 等接口是另一份合同，不能直接套到本 Server 地址。

服务地址、访问凭据、orgId/projectId 由部署提供。除 healthz 外，下列操作均需有该项目权限的 Bearer 凭据；由宿主的已配置 HTTP 能力注入，不打印或写进请求样例。GET 用查询参数传 orgId/projectId；POST 用外层 JSON 字段传 scope，操作参数放在 input 中。

## 发现设备、设备组和用例

`GET /v1/healthz` 只表示服务可达。使用 `GET /v1/lab/catalog?orgId=<实际组织ID>&projectId=<实际项目ID>` 返回的 items 查询 clientId、devices、groups 和 cases。目录存在不证明在线或空闲，结合当前 Client/设备状态核实；找不到目录时报告 Client 尚未接入或发布，不构造设备。

## 提交已有用例

`POST /v1/lab/tasks`，请求形状如下。ID 均替换为真实目录/部署值，requestId 为本次逻辑请求生成并保存的 UUID v4：

```json
{
  "orgId": "configured-org-id",
  "projectId": "configured-project-id",
  "input": {
    "requestId": "f6281bc4-51c0-4b50-85a2-5a0805f64974",
    "clientId": "catalog-client-id",
    "groupId": "catalog-group-id",
    "caseIds": ["catalog-case-id"],
    "name": "用户指定的测试目标"
  }
}
```

可选 options 仅放当前 Server 支持的 startOptions/stress/performanceOptions，不传企业身份或登记字段，不内联步骤。相同请求 ID 与相同内容返回同一任务，冲突先对账。返回 taskId/status；queued 不是已开始，也不是成功。本接口直接返回执行 taskId，不能套用独立调度客户端的 jobId/task_id 两级解释。

## 查询进度、停止和读取报告

- `GET /v1/lab/tasks/{taskId}?orgId=...&projectId=...`：读取原任务状态、progress 及已有 report。
- `POST /v1/lab/tasks/{taskId}/stop`：外层 JSON 传 orgId/projectId；停止请求不等于设备已收尾。
- 需要完整报告时，通过 `POST /v1/lab/commands` 派发只读报告工具，再读取原 commandId 的结果，不重新提交测试。

报告工具请求形状：

```json
{
  "orgId": "configured-org-id",
  "projectId": "configured-project-id",
  "input": {
    "requestId": "94755827-c106-4e92-979d-ab24c8728cd2",
    "clientId": "catalog-client-id",
    "tool": "read_task_report",
    "args": {"taskId": "original-task-id"}
  }
}
```

返回 commandId 仅表示请求被接受；使用 `GET /v1/lab/commands/{commandId}?orgId=...&projectId=...` 查询原回执，并根据 succeeded/failed/unknown 和 result 判断。报告分页等 args 以已部署 Client 真实工具 schema 为准，不靠未知字段试错。工具返回成功与用例验收通过分别判断。

以上四项不要求外部消息平台、业务登记 Skill 或企业账号字段。无真实 Client 时只能验证接口合同，不能宣称已完成设备执行。
