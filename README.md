# Mock LLM 使用说明

## 目录结构

```
config/
  config.yaml
  models/
    _catalog.yaml
    cognition-flash.yaml
    cognition-pro.yaml
    cognition-go.yaml
    cognition-ultra.yaml
  scripts/
    example.js
    init.js
    types.d.ts
```

## 启动方式

```
cargo run -- --config-dir ./config
```

## Admin UI

Build the UI before running the server:

```
cd ui
pnpm install
pnpm run build
```

Then open:

```
http://<host>:<port>/
```

If `server.admin_auth.enabled: true`, enter the admin token when prompted.

## 端点

- `GET /v0/status`
- `POST /v0/reload`
- `GET /v0/config`
- `PUT /v0/config`
- `PATCH /v0/config`
- `GET /v0/models`
- `PUT /v0/models`
- `GET /v0/scripts`
- `GET /v0/scripts/{name}`
- `PUT /v0/scripts/{name}`
- `DELETE /v0/scripts/{name}`
- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /v1/models/{id}`

## 配置说明

`config/config.yaml`：

- `server.listen`：监听地址
- `server.auth.enabled`：是否启用鉴权
- `server.auth.api_key`：Bearer token
- `server.admin_auth.enabled`：是否启用管理端点鉴权
- `server.admin_auth.api_key`：管理 API Bearer token
- `response.reasoning_mode`：`none | prefix | field | both`（兼容 `append`）
- `response.include_usage`：是否返回 usage（估算）
- `models/_catalog.yaml`：默认模型与别名路由（`default_model` / `aliases` / `defaults` / `templates`）

管理 API（`/v0`）：

- `GET /v0/status`：返回配置与模型摘要状态
- `POST /v0/reload`：从磁盘重载配置与模型
- `GET /v0/config`：获取可编辑配置（不含 `server`）
- `PUT /v0/config`：全量替换可编辑配置
- `PATCH /v0/config`：局部更新可编辑配置
- `GET /v0/models`：读取模型打包配置（catalog + models，支持 JSON / YAML）
- `PUT /v0/models`：覆盖模型打包配置（支持 JSON / YAML）
- `GET /v0/scripts`：列出脚本文件
- `GET /v0/scripts/{name}`：读取脚本内容
- `PUT /v0/scripts/{name}`：新建/替换脚本内容
- `DELETE /v0/scripts/{name}`：删除脚本文件
- 鉴权：若 `server.admin_auth.enabled: true`，需 `Authorization: Bearer <admin_key>`
- 变更生效：修改配置/模型/脚本后需手动调用 `POST /v0/reload`，接口带防抖保护

`models/_catalog.yaml` 中 `aliases` 结构：

- `name`：调用名（对外 model 名）
- `providers`：后端 mock 列表（来自 `config/models/*.yaml` 的 `id`）
- `strategy`：`round_robin` / `random`

每个模型一个 YAML（`config/models/<name>.yaml`）：

- `id`：模型 ID（请求用）
- 文件名必须与 `id` 一致（只支持一层文件）
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

- `file`：脚本路径（相对 `config/scripts/`）
- `init_file`：可选初始化脚本（相对 `config/scripts/`，仅执行一次）
- `timeout_ms`：执行超时
- `stream_chunk_chars`：流式分片大小（字符）

## 脚本接口（纯 JS）

脚本需导出 ES module 函数（支持本地 `import`，路径相对脚本文件）。可选 `init_file` 会先执行一次，可在 `globalThis` 上挂载共享数据。

脚本类型定义：`config/scripts/types.d.ts`

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

## Model Config v2 (schema: 2)

- `config/config.yaml`: server + response only.
- `config/models/_catalog.yaml`: `schema`, `default_model`, `aliases`, `defaults`, `templates`.
- `config/models/<id>.yaml`: `schema`, `id`, `kind`, `extends`, `meta`, `static` / `script`.

Static rules:
- `rules` is ordered; exactly one rule must set `default: true` and it must not include `when`.
- `when` supports `any` / `all` / `none` with conditions: `contains` / `equals` / `starts_with` / `ends_with` / `regex`.
- Replies support optional `weight` for weighted pick.

Admin API:
- `GET /v0/models` returns the full bundle (JSON or YAML).
- `PUT /v0/models` replaces the full bundle (JSON or YAML).
