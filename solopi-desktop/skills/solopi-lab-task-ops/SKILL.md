---
name: solopi-lab-task-ops
description: 通过 solopi-lab 管理实验室多机器测试任务：查询资源、提交已有用例、查询进度、停止、读取产物与终态回传。已有 jobId 不重提；适用于已部署服务的任务管理，不承担业务登记或服务部署。
---

# solopi-lab 测试任务管理

本 Skill 随 Server 公开交付，承接发现设备/设备组、提交任务、查询进度、读取报告及停止。先确认部署接口：提供 `/v1/lab/*` 的 Lab Server 使用 [Server 原生 HTTP 合同](references/server-http.md)；下文 CLI 合同仅用于已部署的独立调度客户端，不能把两种服务接口混用。两者都不依赖私有业务 Skill。

按已确认部署使用 Node Server 的原生 HTTP 或独立 `solopi-lab` 客户端管理新任务，服务负责排队、设备组占用、执行和结果投递。不要用直接 `solopi-desktop run`、`submit_task` 或其他执行入口绕过调度。查询用例和报告可使用既有 solopi-desktop-cli，但不能借查询改成另一条执行链。

## 1. 就绪与范围

读取宿主已配置的 `SOLOPI_LAB_CLIENT_CONFIG`；未设置时检查 `$HOME/.config/solopi-lab/client.json`。确认 `command -v solopi-lab`、配置文件可读，再用该真实路径调用：

```sh
solopi-lab --config /absolute/path/client.json call health
solopi-lab --config /absolute/path/client.json call resources
```

`/absolute/path/client.json` 是参数形状说明，必须替换为发现的真实文件。还要核对 `solopi-lab --help` 的合同：应支持 call/mcp/coordinator/node；发布目录中可能有同名的旧 SoloPi CLI（只支持 tools/cases/tasks），它不是新版客户端，不能仅凭文件名或给它加PATH就认定部署成功。不要打印凭据文件、Token或整个环境。程序或配置不存在、401/403、网络或TLS失败时报告具体缺项，不自建临时空服务假装实验室就绪，也不退回旧执行入口。节点存在不代表在线、配对正确或有可运行设备。

确认授权范围、现有 caseIds、环境、版本和采集选项。普通测试不要求企业账户、业务登记或外部工单。若本次任务明确需要安装新包、切换环境或其他前置准备，先通过部署已配置的独立能力完成并核验；能力缺失时报告缺口，不跳过已明确的前置，也不让两个执行服务同时占用同一设备组。

## 2. 提交合同

`requestId` 对应一次逻辑请求，在原调用记录中持久保存，续接或网络重试不重新生成。来源会话标识不是权限凭证。写真实 JSON 文件后提交，不能把自然语言转为 Shell：

```json
{
  "requestId": "stable-logical-request-id",
  "caseIds": ["existing-case-id"],
  "requirements": {"groupId": "confirmed-group-id"},
  "taskName": "本轮明确测试目标",
  "options": {"startOptions": {"recordGlassesScreen": true}},
  "source": {"client": "cli", "correlationId": "original-request-id"}
}
```

示例中的 ID 必须来自本次上下文或 resources 回执，不能照抄。source 是可省略的通用关联对象，不提供权限；示例键只是调用方元数据。只有配置了通知目标时才传 target，且遵守该目标已声明的来源校验条件；没有通知配置仍可提交并查询，不能承诺自动通知。不要向 source 放凭据或绑定某个外部平台。

```sh
solopi-lab --config /absolute/path/client.json call submit --file /absolute/path/request.json
```

- 根字段只接受 requestId、caseIds、requirements、taskName、options、source、target。caseIds 为1–100条明确ID；更大范围先形成可核验的独立分片合同，不能随意分片状态依赖用例。
- requirements 对设备组属性/nodeId/groupId 精确匹配；无条件可省略，不猜设备配对或从旧任务拆换 SN。设备来自租约，不能在 options 里传 devices。
- options 支持 startOptions、performanceOptions、stress、expectedSelectionRevision；录屏开关在 startOptions，压测显式 stress.mode=rounds/duration 和正整数 value，不从任务名推定压测。
- 正常提交响应的 **id 是实验室 jobId**，state=queued 只表示入队；**task_id** 出现才是实际 SoloPi taskId。不要寻找不存在的 submit.success/submitted 字段，也不要把 jobId 冒充 taskId。
- 全忙由服务排队，返回排队状态，不拒绝、不另开CLI抢设备。无符合条件或节点离线时可保持 queued，如实说明；用户没授权，不擅自改条件或无限拆新单。
- 相同 requestId 相同内容返回同一个任务；REQUEST_CONFLICT 先读原请求，不改ID绕过。提交回执未知，先按同一请求对账，不盲目再建。

## 3. 查询、等待与停止

status、stop、artifacts 的参数文件均为 `{"jobId":"返回的实验室id"}`：

```sh
solopi-lab --config /absolute/path/client.json call status --file job.json
solopi-lab --config /absolute/path/client.json call artifacts --file job.json
solopi-lab --config /absolute/path/client.json call stop --file job.json
```

已有 jobId 按原ID查询；只有 taskId 时查询原 SoloPi 报告并找回原job关联，不创建替代任务。`list` 可分页，用 after/limit 和返回 nextAfter；只查当前目标，不反复翻所有历史。

入队后交付 id/state/task_id（如果已存在）并结束本轮，靠已配置完成回调接续，不持续调用模型轮询。未配置回调就明确缺口，不能声称已订阅。stop_requested 表示停止请求已登记，不表示已停；真实终态前设备占用保留。needs_reconciliation 需要维护者对账，不能超时释放或重新跑。维护命令 node-reconcile 不属于普通任务自动修复权限。

## 4. 终态、产物和交付

完成事件只作唤醒，重新读取 status 核 id、task_id、来源与终态。service 的 state=failed 且 task_id 为空可能是提交前拒绝，不能报告成用例已经执行失败；report.submitted=false 表示未提交。真实用例结论依据原 SoloPi report，查询成功不等于业务通过。

分别报告：测试终态、detail.artifactState、deliveries各目标状态。测试成功、产物上传失败、通知失败是不同事实，不得因传输失败重跑测试。artifacts 返回每项 downloadPath 和 caseId 元数据；下载使用：

```sh
solopi-lab --config /absolute/path/client.json download /v1/artifacts/returned-id --output /absolute/new/file
```

输出文件必须不存在。远程机器的本地日志路径不是当前宿主可直接读取的文件；先通过已授权下载获取。分析按 taskId+caseId/原始caseOrdinal 对齐，本例眼镜/手机日志只取实际产物归属，不猜“共享日志”。问题提报仅在用户授权且已配置对应工具时执行；未接缺陷平台仍应交付报告与证据。平台异常不能冒充产品根因。

## 5. 旧任务与迁移边界

来自其他服务或历史部署的 jobId 只属于原服务账本。先从已保存的服务地址和任务关联定位原对象，再使用原入口只读查询；不能把旧 ID 交给新服务或重新提交来“找回”任务。部署迁移与历史 ID 对账需要维护者明确授权，普通任务查询不执行迁移。

本Skill只约束任务操作，不授权部署服务、迁移数据库、改配对、开关设备组或更改业务期望。配置和部署现状以 health、resources 和真实回执为准，不把架构文档当作在线状态。
