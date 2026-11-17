# 公开使用能力

Lab Server 发布必须包含 [`solopi-lab-task-ops`](../../skills/solopi-lab-task-ops/SKILL.md) 及其全部引用文件。该 Skill 是公开使用入口，不是可选的企业插件；`solopi-lab-agent` 负责上层编排，不能代替具体操作合同。

| 必须交付的能力 | 原生接口 |
|---|---|
| 发现设备、设备组和用例 | GET /v1/lab/catalog |
| 提交测试任务 | POST /v1/lab/tasks |
| 查询原任务进度 | GET /v1/lab/tasks/{taskId} |
| 读取报告 | 任务 report；完整报告通过 POST /v1/lab/commands 的 read_task_report 及 GET /v1/lab/commands/{commandId} |

权限和参数见 Skill 的 Server HTTP 引用。独立 Python 调度客户端与此 Node Server 的合同不能混用。

四项能力不得依赖内部平台、登记插件或私有 Skill。发布时必须在无企业扩展的干净环境验证；接口合同测试不能代替真实设备执行验收。当前公开使用 Skill 的目录属于发布内容，缺失时不可将该 Server 包称为完整交付。

发布暂存目录组装后，在 lab-server 目录执行 `npm run verify:public-usage`。检查将拒绝缺少公开 Skill 或断裂引用的交付，不会启动服务或执行设备任务。

## 附件与自建部署

附件通过通用 HTTP 接口 `POST /superagent/conversations/{conversationId}/attachments` 上传，提交 `name`、`mime` 和 Base64 编码的 `data`，返回附件 ID。发送消息时使用 `attachments: [附件ID]` 关联到同一会话。上传者需要拥有目标服务及会话的访问权限。

文件保存在部署者自己的数据目录中，沿用现有的大小、类型及会话归属校验；用户无需接入第三方文件服务。Base64 仅用于 HTTP 传输，模型接收文件名、大小及工作区路径，通过文件工具按需读取，不会自动把文件全文塞入上下文。

需要连接其他任务平台或文件存储时，在服务外部编写适配器，将已获授权的文件下载后转为上述通用请求。平台认证、下载命令和凭据由外部适配器配置和保管，不加入 Server 核心或公共 Skill。


## 回执和耗时

宿主 CLI 的回执按工具调用身份关联。相同调用的重放保留原结果；新的读取会读取最新状态，内容更新后可直接使用同一路径发布。运行中与结果未知的操作仍查询原操作，不重复提交。

`read_request_timing` 读取当前原请求及其平台续接的持久化时间，返回 UTC ISO 起止点、毫秒差和回执定位。历史缺失端点为 null；运行中的 elapsedMs 只表示截至 observedAt。设备耗时另取原生 `read_task_result.timing`；并发工具耗时不能简单相加当作总耗时。
