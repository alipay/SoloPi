# 可选执行包名与环境目标

`run case` 和 `run task` 的 `--phone-package PKG`、`--glasses-package PKG` 都是可选参数，不要求每次提交提供。

默认保留当前用例的 `defaults.phonePackage/glassesPackage`；用例未配置时再取设备默认值。没有明确换包需求时，CLI 不传包名覆盖参数，Agent 也省略 `devices.phone.packageName` / `devices.glasses.packageName`，只指定需要的 SN。扫描到其他包、历史任务使用别的包或简称相近，都不构成覆盖理由。默认包不存在时先反馈精确校验错误，不自动改包、装包或改全局绑定。以下第二行仅用于用户明确要求覆盖的场景。

```bash
solopi-desktop run case CASE_ID --phone PHONE_SN --glasses GLASSES_SN --json
solopi-desktop run case CASE_ID --phone PHONE_SN --phone-package org.example.phone --json
solopi-desktop run task --case-id CASE_A --case-id CASE_B --json
```

每个端分别采用：本次显式覆盖 > 当前用例 defaults.phonePackage/glassesPackage > 设备默认值。批量任务逐条解析，用例A的包名不能覆盖用例B；批量包名不同时任务设备摘要的packageName为空且packageNameSource=case-specific，具体值看该用例执行快照。CLI指定覆盖对本次选中用例生效，不写回用例库或全局绑定。

没有包名且实际步骤不使用包名时继续运行；只有具体步骤依赖包名而无法解析时才报告缺配置。不因为用户没写覆盖参数就询问包名，不猜包、不自动装包、不改用例来绕过错误。

`env get/set --package PKG` 与 `run --env-package PKG` 选择SDK环境文件所属包；它们不覆盖工作流执行包。`run --env` 默认以本次手机覆盖包（若传）或用例手机包作为环境目标，显式env-package可独立选择。环境参数不是必选项，普通运行不默认传env set或force-env-restart。

参数与实际安装帮助核对。旧版本不支持run包名覆盖时报告能力差异，不盲传新参数后误以为已生效，也不重复执行任务或手工ADB代替用例。SDK环境文件或外部应用配置的检查与写操作遵循任务授权和设备占用规则。
