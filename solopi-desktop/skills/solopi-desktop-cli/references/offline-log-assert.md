# 离线正则生成与试跑

先检查当前安装的 `solopi-desktop assert --help`；旧版无此入口时说明需要包含该能力的新版本，不声称已安装或改用整条业务重跑。

```bash
solopi-desktop assert generate --kind json --sample-log 'event: {"ok":true}' --target '{"ok":true}' --json
solopi-desktop assert generate --kind text --sample-log 'text: 目标文案' --target '目标文案' --json
solopi-desktop assert generate --kind json --log sample.log --target-file payload.txt --json
solopi-desktop assert generate --kind text --log sample.log --target '目标文案' --json
solopi-desktop assert try --kind json --log actual.log --line-regex 'event: (.*)' --conditions-file conditions.json --json
```

`--sample-log` 直接接收日志原文字符串；`--log` 接收日志文件路径，两者必须且只能提供一个，generate/try 均支持。字符串不作为路径或 shell 命令执行。

`generate` 与编辑器共用纯代码生成函数。目标必须原样存在于日志样例中；JSON 目标是完整待提取 JSON 文本，不是某个字段的期望值。转义或 shell 敏感内容优先使用 `--target-file`，文件首尾空白按编辑器规则去除。生成后立即验证捕获内容；JSON 模式同时解析 JSON。此命令不写入组件或用例。

`try` 逐行扫描文件；JSON 优先取命名组 `json`，其次首个捕获组，否则从整行解析 JSON；text 优先命名组 `ttsText`，其次首个捕获组。JSON 递归解析嵌套对象/数组中的 JSON 字符串，沿用执行器深度上限 8，不修补畸形 JSON。`--ignore-case` 影响日志正则；条件可单独设 `ignoreCase`。

条件文件示例：`[{"path":"data.items[0].status","operator":"equals","value":"ok"}]`。支持 equals/notEquals/contains/notContains/regex/notRegex/exists/notExists，沿用执行器按路径查找和嵌套搜索语义。省略条件时只验证捕获和解析。text 的 `--target` 可校验提取内容精确一致。

回执含 lineRegex、matchedCount、passedCount、matches[].lineNumber/line/captured/parsed/conditions；每个条件含 passed、actual、expected，失败附 error。至少一行全部通过退出 0，否则退出 1。默认只返回前 20 个匹配明细，可用 `--limit 1..1000` 调整；truncated 表示明细未全列出，计数仍覆盖全文件。生成样例可包含换行；try 与实时执行器一样逐行匹配。

这是单行提取诊断，不模拟负向断言的等待窗口，也不证明业务通过。不启动模型、任务、ADB 或设备；不修改用户配置。
