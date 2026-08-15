# 参与 SoloPi 贡献

感谢你参与 SoloPi。当前公开贡献范围包括：

- `solopi-app`：Android 真机执行、录制回放、动态协议、性能与证据；
- `solopi-harness-cli`：宿主机 CLI、验证、托管与报告；
- `solopi-skill`：Agent 使用规则、能力说明和薄启动入口。

## 开始之前

较大的功能、协议变更、安全策略或不兼容修改，请先创建 Issue，说明：

1. 要解决的真实问题；
2. 受影响的模块和用户流程；
3. 兼容性、安全性和迁移方案；
4. 计划补充的测试与文档。

小型错误修复和文档修正可以直接提交 Pull Request。

提交贡献前，需要完成项目维护方要求的 Contributor License Agreement。具体流程以公开仓库
Pull Request 中的提示为准。签署协议不代表获得仓库写权限，但允许维护方依法接收贡献并保留
作者归属。

## 开发环境

- Python 3.9 或更高版本；
- Android SDK 与 `adb`；
- JDK 11；
- macOS 或 Linux。

建议先运行三模块的最小门禁：

```bash
python3 -m unittest discover -s solopi-harness-cli/tests -v
./solopi-skill/scripts/solopi-ai --pretty actions
./solopi-app/gradlew -p solopi-app \
  :app:testDebugUnitTest \
  :agentmodel:testDebugUnitTest \
  :portal:assembleDebug
```

涉及真机的修改还应在专用测试设备和测试账号上验证，并在 Pull Request 中说明设备、系统版本、
测试范围和真实结果。不要提交业务 App 截图、账号信息、完整 Logcat、Token 或其他敏感证据。

## 模块约束

### solopi-app

- 保持被测 App 零侵入，不要求业务接入 Agent SDK；
- 动态动作必须在真正触屏前完成当前页面和会话检查；
- 设备状态变更应通过受保护的 ADB 通道，不新增任意 HTTP、Scheme 或 Shell 后门；
- 新增 Java 文件应带 Apache-2.0 许可证头和清晰的类级说明；
- 涉及页面树、截图、输入或日志时，必须考虑脱敏、存储位置和保留期。

### solopi-harness-cli

- 保持类型化命令和结构化 JSON 输出；
- 不得把“请求已受理”报告为业务成功；
- 修改协议或 Schema 时，需要同时更新版本、兼容检查、测试和 Skill 文档；
- 文件输出应使用明确路径和排他创建，避免覆盖未知文件；
- 新增外部网络访问时，必须说明允许的协议、目标范围、重定向和隐私边界。

### solopi-skill

- Skill 是规则和路由入口，不复制 CLI 的核心实现；
- 命令、参数、状态或安全边界变化时，同步更新 `SKILL.md` 和相关 references；
- 文档必须区分用户输入、Agent 推断、设备事实和 Result Judge 结论；
- 不得指示 Agent 绕过权限、执行任意 Shell、自动接受系统授权或伪造证据。

## 跨模块协议变更

以下修改必须在同一个 Pull Request 中闭环：

- App 新增或修改协议字段、动作、状态或错误码；
- CLI 新增命令或改变输出 Schema；
- Skill 新增可调用能力或修改成功标准；
- Harness/Agent 协议版本或兼容范围变化。

至少需要：

1. App 或 CLI 实现；
2. CLI 单元/契约测试；
3. Skill 使用规则和示例；
4. 兼容性与迁移说明；
5. 失败路径和安全边界测试。

不兼容变更必须在任何设备副作用发生前被识别和拒绝。

## 测试与证据

- 单元测试应覆盖正常、失败、边界和恢复路径；
- 动态协议应覆盖旧 Observation、重复 step、预算耗尽和会话清理；
- Result Judge 应覆盖 `passed`、`failed` 和 `not_tested`，并证明 Agent 的 `done` 不能覆盖验收结果；
- 托管执行应覆盖 lease 过期、Worker 接管、旧 generation 写入拒绝和重试耗尽；
- 性能结论必须同时说明数值、采样口径、会话状态和阈值，缺少阈值时不宣称达标；
- 真实设备证据必须去除账号、Token、个人信息和无关业务数据。

## 第三方代码与素材

不要直接复制来源不明的博客、问答网站或代码片段。引入第三方源码、依赖、模型、图片或二进制时，
Pull Request 必须包含：

- 上游仓库或原始来源；
- 精确版本、tag 或 commit；
- 许可证及必要的版权归属；
- 本项目的修改说明；
- 对 `NOTICE`、SBOM 和发行物的影响；
- 二进制对应的源码和可复现构建方式。

无法证明允许再分发的内容不会被合入。

## 代码和提交规范

- 遵循所修改模块的现有风格，避免与功能无关的大规模格式化；
- 提交应保持单一目的，提交信息使用祈使语气并说明“为什么”；
- 修复 Issue 时在 Pull Request 中关联对应编号；
- 不提交构建产物、IDE 配置、临时证据、私钥、账号或本机绝对路径；
- 更新行为时同步更新用户文档和失败示例。

## Pull Request 检查清单

- [ ] 改动位于公开的三个模块或必要的根级文档与许可证文件；
- [ ] 已运行相关测试和构建，并记录结果；
- [ ] 已处理协议、兼容性和迁移影响；
- [ ] 已覆盖失败、清理和安全路径；
- [ ] 未包含秘密、个人信息或真实业务数据；
- [ ] 第三方内容已有清晰来源、许可证和归属；
- [ ] 用户文档和 Skill 规则与实现一致。

## 许可证

除非另有明确说明，提交到本项目的贡献按照仓库根目录的
[Apache License 2.0](LICENSE) 提供。第三方内容继续适用其原有许可证。
