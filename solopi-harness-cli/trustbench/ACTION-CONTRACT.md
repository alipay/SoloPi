# 动作契约 v1：受约束的执行放行

这是开发修复，不替换 coverage-v1 冻结协议或成绩。现有失败样本用于回归，不能再次作为独立验证集。
已完成的单测、构建及 14 条真机开发检查见[验证结果](ACTION-CONTRACT-RESULTS-20261019.md)。
冻结策略后的[两个新场景配对验证](CONTRACT-TRANSFER-RESULTS-20261019.md)也已完成，单独记录，不合并旧成绩。

## 信任来源与使用

契约来自可信的用例配置或应用适配器，不由模型生成，也不从变化后的页面反推期望值。
在 `agent-session-start` 或 `verify-run` 中传入 `--agent-action-contract contract.json`。
宿主先检查设备声明 `actionContractVersion=1`，旧 APK 不会静默忽略契约。
JSON 在每个会话启动时传到设备，设备保存不可变字符串；每次动作都执行校验，
包括重新观察后页面签名完全匹配的情况。模型没有修改契约的动作字段。

```json
{
  "version": 1,
  "packageName": "com.example.inventory",
  "action": {
    "type": "input",
    "targetResourceId": "com.example.inventory:id/quantity",
    "text": "8"
  },
  "bindings": [
    {"role": "object", "resourceId": "com.example.inventory:id/item", "text": "Item A"},
    {"role": "unit", "resourceId": "com.example.inventory:id/unit", "text": "units"}
  ],
  "volatileTextResources": ["com.example.inventory:id/memo"]
}
```

v1 仅支持一个类型为 `click` 或 `input` 的目标动作。`click` 的 action 不包含 `text`；
`input` 必须固定输入文本。字段严格匹配，不接受未知字段或省略必需字段。
至少绑定一个 object 或 unit 角色；场景同时涉及对象和单位时必须同时声明，执行器不能
自动发现用例漏写的业务约束。角色、资源不能重复。

## 执行规则

- 目标及绑定字段在原观察和新快照中必须同包、可见、资源 ID 唯一；绑定文字精确匹配。
- 动作必须指向原观察中的目标 nodeId，类型及输入值匹配契约。目标必须 enabled，
  点击目标必须 isClickable，输入目标必须 isEditable。
- 只允许 `volatileTextResources` 声明的叶节点文字变化；其存在性、可见性、布局、
  类别、交互标记和其他字段仍需一致。不能把目标或业务绑定列为可变字段。
- 除宿主 nodeId 注解及上述文字外，完整树结构和其他内容必须一致。
- 在同一新快照树上按包名和资源 ID 重新唯一定位目标，不用模糊选择器寻找替代对象。
- 不满足契约时回执为 `action_contract_violation`，动作不分发。新观察、新模型建议
  或相同页面签名都不能绕过冻结绑定。

未配置契约时维持严格上下文检查；不可读配置会在宿主启动前失败，损坏或不完整的
契约在设备动作校验时拒绝。契约不会扩大旧观察有效期、动作预算、会话所有权或单次使用权限。
`--agent-reobserve-stale` 仍只对内容等价页面允许一次新决策；本功能不放宽它。

## 可重复开发验证

构建并安装当前隔离调试 APK 后运行（设备必须是可重置的 TrustBench 测试设备）：

```sh
cd solopi-harness-cli
PYTHONPATH=src python3 -m solopi_harness.trustbench_contract_regression \
  --serial YOUR_DEVICE_SERIAL \
  --root /absolute/path/to/NEW-contract-regression \
  --solopi-apk ../solopi-app/portal/build/outputs/apk/debug/portal-debug.apk \
  --fixture-apk /absolute/path/to/coverage-v1.apk
```

夹具源码及构建脚本见 [android-coverage/build.sh](android-coverage/build.sh)。新输出目录必须不存在。
脚本核对安装 APK 哈希，在动作前冻结源文件哈希，保留契约、观察、注入检查、设备回执
与 run-as 业务存储读回。12 个原反例条件加 2 个新观察后继续提议输入的控制条件，
使用现有夹具，不调用模型，不计入 benchmark，不写视频或全量 logcat。失败即保留证据并停止。

## 能力边界

契约正确性依赖可信配置是否完整表达业务意图；误声明无关字段仍可能破坏安全假设。
UI 快照没有提供应用内部事务或业务服务端原子校验，检查与实际执行之间仍有时间窗口。
这不是任意应用零漏拦、零误拦的证明。真机回归结果应单独记录，不能由单测或 APK 构建结果代替。
