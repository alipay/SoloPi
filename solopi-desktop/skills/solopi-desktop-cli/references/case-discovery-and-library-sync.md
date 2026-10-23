# 用例发现与本地库同步

只在用户未提供 caseId、需要递归目录发现，或明确要求 Git 用例库同步时读取。

## 一次发现

执行一次 `cases list --json`。按 `folders[].parentId` 建树，目标目录包含自身与所有后代目录；`cases list --folder` 不是递归查询。

已有 caseId 不运行 `cases list`。需要查看某条用例完整组件、canonical 边或位置时才用：

```bash
"$SOLOPI_DESKTOP_CLI" cases show <caseId> --json
```

执行顺序以 `caseEdges[caseId]` 为准，不能按 `steps[]` 插入顺序推断。

## 本地热刷新

Agent 修改 solopi-desktop 已缓存的本地 JSON/YAML 后，用户在 FLOW 顶部点击“刷新用例”。刷新只读取本地文件，不隐式 Git pull/push。CLI `cases list/show` 的 `stateRevision`、`libraryRevision` 应与 UI 一致。

## Git 授权边界

普通“修改用例”只允许本地改动。只有用户明确要求上传/同步远端时才执行：

```bash
"$SOLOPI_DESKTOP_CLI" cases libraries --json
"$SOLOPI_DESKTOP_CLI" cases pull --library <id|name> --dry-run --json
"$SOLOPI_DESKTOP_CLI" cases push --library <id|name> --message "<message>" --dry-run --json
```

先 dry-run，确认目标库和范围后才执行写操作。禁止绕过 CLI 直接 Git push。
