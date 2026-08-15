# SoloPi 用例编写

创建、克隆、校验或导入 SoloPi 用例 JSON 时，请参考本文。

需要查询全部内置动作代码、节点要求、动态 Provider 和必填参数时，先运行 `actions`，再读取 [action-catalog.md](action-catalog.md)。`actions` 是离线契约，不会扫描设备插件新增的动作。

## 定位规则

1. 为现有应用流程添加步骤时，优先使用 `case-get` 克隆可正常运行的用例。
2. 如果没有用例包含目标节点，使用 `inspect` 观察当前页面。
3. 必须原样复制选择器值。不得编造 `resourceId`、`text`、`description`、`xpath`、`id`、包名或类名。
4. 保留目标应用包名。未经重新检查，不得跨应用包复制选择器。
5. 动态文本和绝对 XPath 较脆弱。优先使用稳定的 `resourceId`，其次使用稳定的文本或描述，同时保留真实节点中观察到的其他字段。

校验器会确保节点动作包含选择器，但无法证明该选择器能在特定页面上定位成功。

通过 `inspect` 获取页面树后，只从返回节点复制 `resourceId`、`text`、`description`、`xpath` 或 `id`。页面变化后重新检查，不要维护类似固定点击 ID 的全局字典。

## 编写结构

编辑时将 `operationLog` 保持为对象。`case-validate` 会将其转换为 SoloPi 导入所需的编码 JSON 字符串。

```json
{
  "caseName": "payment-smoke",
  "caseDesc": "支付冒烟测试",
  "targetAppPackage": "com.example.pay",
  "targetAppLabel": "支付应用",
  "recordMode": "local",
  "advanceSettings": "",
  "priority": 2,
  "operationLog": {
    "steps": [
      {
        "operationNode": null,
        "operationMethod": {
          "actionEnum": "SLEEP",
          "operationParam": {"text": "1000"},
          "encrypt": false,
          "safeEncrypt": false
        },
        "operationIndex": 0,
        "operationId": "ai-payment-smoke",
        "stepId": "ai-step-001"
      }
    ]
  }
}
```

必填顶层字段为 `caseName`、`targetAppPackage` 和非空的 `operationLog.steps`。省略描述、标签、录制模式、设置、优先级、索引、ID 或加密标志时，CLI 会补充安全默认值。不得提供 `id`、时间戳、`selected` 或 `storePath`；这些字段由导入器管理。

## 步骤结构

每个步骤包含：

- `operationMethod.actionEnum`：SoloPi 枚举名（如 `CLICK`）或对应代码（如 `click`）；校验时会将代码规范化为枚举名。
- `operationMethod.operationParam`：值为字符串的动作参数。数字和布尔值会规范化为字符串。
- `operationNode`：全局、应用或设备动作使用 `null`；节点动作使用复制的节点描述。
- `operationIndex`：从零开始的执行顺序。
- `operationId`：录制分组 ID。线性编写的用例应保持同一个稳定值。
- `stepId`：用于失败证据的唯一稳定 ID。

需要 `operationNode` 的节点动作包括 `CLICK`、`LONG_CLICK`、`INPUT`、`MULTI_CLICK`、`CLICK_IF_EXISTS`、`CLICK_QUICK`、`CLICK_AND_INPUT`、`INPUT_SEARCH`、各方向节点滚动、`GESTURE`、`ASSERT`、`SLEEP_UNTIL`、`OTHER_NODE`、`LET_NODE` 和 `CHECK_NODE`。

4 个用例界面枚举 `DELETE_CASE`、`EXPORT_CASE`、`PLAY_MULTI_TIMES`、`GEN_MULTI_PARAM` 应分别通过 `case-delete`、`case-get`、`run-repeat`、`case-validate --running-params-file` 完成，不得写入步骤。`GEN_MULTI_PARAM` 修改单个用例的高级参数设置，与 `run-batch` 的多用例顺序执行不同。`CANCEL`、`FOCUS`、`FINISH`、`PAUSE`、`RESUME`、`FORCE_STOP`、`NORMAL_EXIT` 也不是普通回放步骤。

动态 Provider 使用 `OTHER_GLOBAL` 或 `OTHER_NODE` 承载，并必须提供 `operationParam.targetAction`。性能记录、录屏和图片比较还有专属必填参数、插件与权限边界；不要手工猜测，读取 [动作目录](action-catalog.md) 并优先克隆真机录制步骤。

## 常用动作

| 动作 | 节点 | 参数 |
|---|---|---|
| `CLICK` | 必填 | 可选的 `localClickPos`，从真实用例复制 |
| `INPUT` | 必填 | `text`：输入内容 |
| `LONG_CLICK` | 必填 | `text`：长按时长 |
| `ASSERT` | 必填 | `assertMode`、`assertInputContent` |
| `SLEEP_UNTIL` | 必填 | `text`：最大等待时长 |
| `BACK`, `HOME`, `RELOAD` | 无 | 无 |
| `SLEEP` | 无 | `text`：毫秒数 |
| `SCREENSHOT` | 无 | `text`：证据名称 |
| `JUMP_TO_PAGE` | 无 | `scheme`：目标深链 |

字符串断言模式为 `assert_accurate`、`assert_contain` 和 `assert_regular`。录制用例中也存在数值模式；应原样复制准确模式，不要自行重构。

编写 `CLEAR_DATA`、`KILL_PROCESS`、外部深链或包含凭据、支付数据的步骤前，必须先获得用户对范围的明确授权，并在 `case-validate`、`case-import` 和 `run*` 中显式使用 `--confirm-high-risk`。Skill 不提供任意 Shell，新用例不得加入 `EXECUTE_SHELL`；内部 `HANDLE_PERMISSION_ALERT` 可能自动确认系统权限，`HIDE_INPUT_METHOD` 也不对外开放。三项已有步骤只能由 `case-step-list` 查看，CLI 固定拒绝校验、导入和回放。不得在用例 JSON 或证据路径中放置秘密信息。

## 本地步骤编辑

先用 `case-get --output` 导出用例，再用 `case-step-list` 查看准确索引。添加、更新、删除、移动和复制分别使用 `case-step-add`、`case-step-update`、`case-step-delete`、`case-step-move`、`case-step-copy`。每次变更都要求 `--output` 指向不同于源文件的新路径，默认拒绝覆盖已有文件；检查差异后再继续编辑或运行 `case-validate`。

步骤文件只包含单个步骤对象。所有变更都会重新编号 `operationIndex`，并再次执行完整动作、参数、节点选择器、唯一 `stepId` 和动态 Provider 配对校验。高风险动作要求 `--confirm-high-risk`；该确认在步骤编辑、整用例校验、导入和回放各阶段分别生效，不跨命令继承。`EXECUTE_SHELL`、`HANDLE_PERMISSION_ALERT`、`HIDE_INPUT_METHOD` 可由 `case-step-list` 展示，但不得新增、更新、移动、复制、导入或回放。Provider 上传 URL 固定拒绝。结构校验不证明选择器、插件、权限或业务流程可用，最终仍须导入并真机回放到终态。

## 多参数用例

先从设备导出准确用例，再准备一个独立的运行参数文件。`UNION` 模式的每一行是一组完整参数，所有行必须使用相同的键：

```json
{
  "mode": "UNION",
  "paramList": [
    {"account": "alice", "region": "cn"},
    {"account": "bob", "region": "us"}
  ]
}
```

`SEPARATE` 模式的每一项只能包含一个不重复参数，值使用英文逗号分隔；设备会生成各参数值的组合：

```json
{
  "mode": "SEPARATE",
  "paramList": [
    {"account": "alice,bob"},
    {"region": "cn,us"}
  ]
}
```

使用新的输出文件，不覆盖导出的原始用例：

```bash
scripts/solopi-ai --pretty case-get \
  --case "payment-parameterized" --output cases/payment-parameterized.json
scripts/solopi-ai --pretty case-validate \
  --file cases/payment-parameterized.json \
  --running-params-file cases/payment-parameters.json \
  --output cases/payment-parameterized.import.json
scripts/solopi-ai --pretty case-import \
  --file cases/payment-parameterized.import.json --replace
```

`case-validate` 会保留 `advanceSettings` 中其他字段，同时严格校验已有或新写入的 `runningParam`。清除参数配置时改用 `--clear-running-params`，仍先检查新的输出文件再导入。参数集合可能包含账号或业务数据，应使用脱敏测试值，不要直接放入命令行。

## 闭环流程

```bash
scripts/solopi-ai --pretty doctor
scripts/solopi-ai --pretty apps
scripts/solopi-ai --pretty actions
scripts/solopi-ai --pretty cases
scripts/solopi-ai --pretty case-get \
  --case "base-payment" --output cases/payment-smoke.json
scripts/solopi-ai --pretty case-validate \
  --file cases/payment-smoke.json --output cases/payment-smoke.import.json
scripts/solopi-ai --pretty case-import \
  --file cases/payment-smoke.import.json
scripts/solopi-ai --pretty run \
  --case "payment-smoke" --artifacts artifacts/payment-smoke
scripts/solopi-ai --pretty result --run-id '<run-id>'
```

仅在需要覆盖现有同名用例时使用 `--replace`。包含高风险动作时，示例中的 `case-validate`、`case-import` 和 `run` 都要分别添加 `--confirm-high-risk`。导入后重新运行 `cases`；执行前还会确认图片对比或录屏插件已由本地安装并加载，不会自动下载。启动时同时绑定预检返回的 `caseId` 和 SHA-256 指纹，同名用例被替换时失败。执行后必须确认状态为 `passed`、退出码为 `0`、至少有一条回放结果，并已生成所需产物。
