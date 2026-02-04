# Mock LLM 使用说明

## 目录结构

```
config/
  config.yaml
  models/
    llm-flash.yaml
    llm-pro.yaml
    llm-ultra.yaml
    scripts/
      example.js
```

## 启动方式

```
cargo run -- --config-dir ./config
```

## 端点

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /v1/models/{id}`

## 配置说明

`config/config.yaml`：

- `server.listen`：监听地址
- `server.auth.enabled`：是否启用鉴权
- `server.auth.api_key`：Bearer token
- `response.reasoning_mode`：`append | field | both`
- `response.include_usage`：是否返回 usage（估算）
- `models_dir`：模型目录（相对 `config/`）
- `default_model`：请求未指定 model 时的默认模型（默认 `llm-flash`）
- `routing.aliases`：调用名到实际 mock provider 的映射

`routing.aliases` 结构：

- `name`：调用名（对外 model 名）
- `providers`：后端 mock 列表（来自 `config/models/*.yaml` 的 `id`）
- `strategy`：`round_robin` / `random`

每个模型一个 YAML（`config/models/<name>.yaml`）：

- `id`：模型 ID（请求用）
- `owned_by`：所有者
- `created`：Unix 时间戳，可选
- `type`：`static` 或 `script`

`static` 模型：

- `replies`：回复列表
- `strategy`：`round_robin` / `random` / `match`
- `stream_chunk_chars`：流式分片大小（字符）

`match` 策略：

- `match` 可为字符串、正则对象或数组（任一匹配即命中）
- 字符串为包含匹配；正则必须使用 `{ regex: "/.../i" }` 这种写法（大小写用 `i` 标志）
- 匹配严格按 **replies 顺序**，命中即返回
- `match` 策略要求**最后一条 reply 不带 match**，作为默认回复

`script` 模型：

- `file`：脚本路径（相对模型文件目录）
- `init_file`：可选初始化脚本（仅执行一次）
- `timeout_ms`：执行超时
- `stream_chunk_chars`：流式分片大小（字符）

## 脚本接口（纯 JS）

脚本需导出 ES module 函数（支持本地 `import`，路径相对脚本文件）。可选 `init_file` 会先执行一次，可在 `globalThis` 上挂载共享数据。

脚本类型定义：`config/models/scripts/types.d.ts`

示例脚本已包含：

```js
// @ts-check
/** @param {import("./types").ScriptInput} input */
export function handle(input) { ... }
```

```js
export function handle(input) {
  return { content: "text", reasoning: "optional", finish_reason: "stop" };
}
```

输入对象：

```
{
  request: <原始请求 JSON>,
  parsed: { model, messages, stream, temperature, top_p, max_tokens, stop, extra },
  model: <模型配置>,
  meta: { request_id, now }
}
```

## Docker 挂载建议

```bash
docker run -p 8000:8000 -v $(pwd)/config:/app/config mock-llm
```

## Docker Compose

```bash
docker compose up --build
```

## GHCR 镜像构建

仓库包含 GitHub Actions：`.github/workflows/publish-ghcr.yml`，会在 `main` 分支与 `v*` 标签推送时构建并发布到 `ghcr.io/<owner>/<repo>`。

## Windows 打包

`.github/workflows/build-binaries.yml` 会在 `main` 分支与 `v*` 标签构建 Windows 发行包，输出 `mock-llm-windows-x86_64.zip`（包含 `mock-llm.exe` 与默认 `config/`）。
