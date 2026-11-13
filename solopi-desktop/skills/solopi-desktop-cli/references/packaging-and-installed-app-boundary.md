# 已安装 App 与候选包边界

只在 solopi-desktop 开发、打包、发版或候选验收任务中读取；普通用例运行禁止读取。

- 动态运行只能使用用户已安装且明确选定的唯一 solopi-desktop。
- 候选 App/ZIP/DMG 只做文件、签名、manifest、ZIP 和 DMG 静态门禁。
- Agent 禁止安装、复制、解压、启动候选 App，也禁止执行候选包内 CLI。
- 禁止 `/private/tmp`、`open -n`、wrapper、hardlink/symlink、自动 xattr 或安全策略绕过。
- macOS 同名证书必须使用完整 SHA-1；受限环境无法访问 securityd/keychain 时不能据此判定签名无效。
- 安装替换和动态验收必须由用户明确授权，并只操作唯一安装位置。

完整打包流程以仓库 `docs/PACKAGING.md` 和可用的 `package-solopi-desktop-macos` Skill 为准。
