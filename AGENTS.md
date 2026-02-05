# AGENTS

本文件面向自动化或协作工具，提供最小必要的工程约定。用户文档请见 `README.md`。

## 约定

- **简体中文回复**，中文需注意UTF8编码
- 默认配置模板来源于 `config/`，并通过 `src/init.rs` 的 `include_str!` 引入。
- 变更默认配置时，优先修改 `config/` 下文件，`src/init.rs` 会自动同步。
- `match` 策略要求最后一条 reply 不带 match，命中顺序严格按 replies。

## 关键目录

- `src/`：核心服务逻辑
- `config/`：默认配置与示例
- `.github/workflows/`：CI 与构建

## 基本检查

- `cargo check`
