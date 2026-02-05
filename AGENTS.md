# AGENTS

本文件面向自动化或协作工具，提供最小必要的工程约定。用户文档请见 `README.md`。

## 回复与编码

- **简体中文回复**
- 含中文的文件请使用 UTF-8 编码

## 目录结构

- `src/`：Rust 服务端核心逻辑
- `config/`：默认配置与示例
- `config/models/`：模型目录（catalog + 单模型）
- `config/scripts/`：脚本模型与类型定义
- `ui/`：管理界面（Vite），`ui/dist` 为构建产物
- `.github/workflows/`：CI 与发布
- `Dockerfile` / `docker-compose.yml`：容器化
- `build.rs`：构建期资源处理

## 配置约定

- 默认配置模板来源于 `config/`，并通过 `src/init.rs` 的 `include_str!` 引入
- 变更默认配置时，优先修改 `config/` 下文件，`src/init.rs` 会自动同步
- `models/_catalog.yaml` 定义 `default_model` / `aliases` / `defaults` / `templates`
- 单模型文件 `config/models/<id>.yaml`：文件名需与 `id` 一致
- `match` 策略要求最后一条 reply 不带 match，命中顺序严格按 replies

## 关键模块

- `src/main.rs`：启动与路由
- `src/handlers.rs`：OpenAI 兼容接口
- `src/admin.rs`：管理接口
- `src/config.rs`：配置读取与合并
- `src/kernel.rs`：模型选择与执行
- `src/interactive.rs`：交互式模型
- `src/scripting.rs`：脚本模型
- `src/streaming.rs`：流式响应
- `src/ui.rs`：UI 静态资源服务

## 基本检查

- `cargo check`
- `pnpm typecheck`
