# 报告页面性能诊断

加载包含较多用例、截图的报告并复现滚动后，可使用现有 CLI 导出本地诊断：

```sh
solopi-desktop logs export --output ./report-diagnostics.json.gz --json
```

在解压后的 `records` 中按 `event = report.view.performance` 和 `taskId` 查询。
记录写入应用数据目录 `diagnostics/runtime.jsonl`，沿用现有轮转与导出机制。

## 记录时机与范围

- `open`：报告页面开始观测。
- `paint`：观测开始后的下一动画帧；不等于全部详情/截图已读取完成，也不是从点击报告开始计算的完整加载耗时。
- `sample`：最多每 10 秒一条，指标无变化或页面不可见时不写。
- `close`：离开报告或切换任务时最后一条累计摘要，清理计时器和观察器。

主进程另限制每个界面进程每分钟最多 12 条，拒绝不合法值及任意正文。日志失败不阻断报告操作。
不记录用例名称、截图路径、图片内容、命令或业务日志。不会逐次滚动、逐张截图写日志。

## 如何判断瓶颈

| 字段 | 含义 |
| --- | --- |
| `durationMs` | 本次报告页面观测已持续多久；其余累计指标也属于本次访问 |
| `caseCount` / `visibleCaseCount` | 已加载的报告用例总数 / 当前实际挂载的用例详情数，含预加载边距 |
| `thumbnailRequests` / `thumbnailCacheHits` / `thumbnailSharedReads` | 缩略图订阅次数 / 缓存命中次数 / 合并到已有读取的次数 |
| `thumbnailReads` / `thumbnailFailures` / `thumbnailDecodeFailures` | 实际发起的读取数 / IPC读取失败数 / 界面图片加载或解码失败数 |
| `thumbnailActive` / `thumbnailQueued` / `thumbnailCacheEntries` | 当前读取、排队及缓存数量；读取并发上限3，缓存上限48 |
| `thumbnailPeakActive` / `thumbnailPeakQueued` | 本次访问的并发和队列峰值 |
| `thumbnailReadMs` / `thumbnailMaxReadMs` / `thumbnailMaxQueueMs` | 累计读取耗时 / 最慢一次读取耗时 / 最长排队耗时；读取包括IPC、文件读取和缩略图生成 |
| `thumbnailCancelled` | 因订阅者已经离开而跳过的排队读取数；不代表已取消主进程内正在进行的文件读取 |
| `longTaskObserverSupported` | 1表示长任务观察器可用，0表示不能据计数0判断没有卡顿 |
| `longTaskCount` / `longTaskMs` / `maxLongTaskMs` | 观测期间界面进程中至少50ms的长任务次数、总耗时及最大耗时；可能包含同时运行的投屏等其他组件，不能直接归因于报告 |
| `renderSampleCount` / `renderMs` / `maxRenderMs` | React Profiler样本数、累计/最大实际渲染耗时；普通生产React可能关闭Profiler。样本数0时不输出渲染耗时，不能当成耗时0 |
| `rendererHeapUsedBytes` | 当前整个界面进程的JS堆占用，非图片解码内存或报告独占内存；0可能表示运行时没有该接口 |

例如，挂载详情数随总用例数线性增长说明视口优化未生效；并发峰值超3说明需要检查入口是否绕过队列。
读取很慢但没有长任务，优先检查文件/IPC/主进程；长任务明显而读取正常，需要继续录制界面性能轨迹，区分报告、投屏和其他更新。
指标用于定位，不替代真实报告的帧率/内存对比验证。
