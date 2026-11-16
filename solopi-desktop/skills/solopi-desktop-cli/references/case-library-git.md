# 用例库仓库配置与同步

支持 macOS、Linux、Windows；使用用户选定安装的 CLI 和同一数据目录，Git 认证沿用系统凭据，不在URL或对话中填写密钥。Linux固定CLI入口以实验室部署说明为准。

```bash
solopi-desktop cases libraries --json
solopi-desktop cases configure --library LIBRARY_ID --repo https://example.test/group/cases.git --branch main --dry-run --json
solopi-desktop cases configure --library NEW_LIBRARY_ID --name "新用例库" --repo https://example.test/group/cases.git --branch main --create --json
solopi-desktop cases pull --library LIBRARY_ID --dry-run --json
solopi-desktop cases push --library LIBRARY_ID --message "更新用例与素材" --dry-run --json
```

配置预览不访问远端；去掉dry-run保存配置。省略repo/branch/name保留原值，不重置凭据/用例/设备绑定。新建必须明确create，不会偷偷创建同名库。

Agent原生入口为 `case_library_list` / `case_library_configure` / `case_library_pull` / `case_library_push`，参数library填ID或唯一名称；name/repoUrl/branch/create/dryRun用于配置，message用于推送。原生工具缺少时先核对安装CLI的真实帮助，不能宣称整个平台不支持。

拉取dry-run会读取远端并更新缓存，不写用例库；核对commit、分支、用例数和素材后按授权去掉dry-run。拉取不会包含另一台机器尚未提交的编辑；先核对来源，不用相同数量代替内容比对。推送必须用户明确授权提交远端，核对dry-run变更后执行；不强推、不自动重试未知结果，不借发布软件授权推送业务用例仓库。

CLI写操作及Agent工具通过同一Broker服务与UI保存确认执行，库同步期间返回CASE_LIBRARY_BUSY。保留唯一回执，超时后核对当前配置/commit，禁止盲目重提。

`export_cases`仅导出本地编辑文件，`quick_action_export_git`仅推快捷操作脚本；都不是用例库推送。运行用例是submit_task/run case/run task，与Git提交不同。包名默认沿用用例，Git同步不自动更换设备或包名。
