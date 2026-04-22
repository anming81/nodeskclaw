# OpenClaw 内置钉钉通道插件（openclaw-channel-dingtalk）实现分析

## 1. 结论摘要

`openclaw-channel-dingtalk` 是一个基于 OpenClaw Plugin SDK 的 Channel 插件，采用“Stream 长连接收消息 + Webhook/Robot API 回消息”的双通道架构：

1. 入站：通过钉钉 Stream 协议建立 WebSocket，订阅机器人回调，接收用户消息并 ACK。
2. 编排：将文本消息转发到本地 OpenClaw Gateway（`/v1/chat/completions`，SSE 流式），聚合模型增量输出。
3. 出站：优先使用 `sessionWebhook`（会话级即时回复）；过期或不可用时回退到钉钉 Robot `batchSend` API。

该插件被后端以“源码文件复制 + openclaw.json 注入插件路径”的方式部署到实例目录，并在实例启动后由 OpenClaw 运行时加载。

## 2. 插件边界与元数据

插件目录包含最小可运行文件集：`index.ts` 入口、`src/*.ts` 业务代码、`openclaw.plugin.json` 元数据、`package.json` 渠道声明。`README.md` 明确指出插件不依赖 `dingtalk-stream` npm 包，而是使用 Node 内置 `fetch`/`WebSocket`，以适配“仅复制文件、不执行 npm install”的部署模型。

- `openclaw.plugin.json` 声明插件 `id = dingtalk` 且暴露频道 `channels = ["dingtalk"]`。
- `package.json` 的 `openclaw.channel` 提供 UI 展示信息（label、docsPath、aliases）。

## 3. 启动与注册流程（index.ts）

插件启动时流程如下：

1. `register(api)` 注入 runtime（供后续 activity 记录）并注册 `dingtalkPlugin`。
2. 从 `api.config` 读取所有账号，选取首个“已配置且启用”的账号。
3. 为该账号创建 `DingTalkStreamClient` 并启动。
4. 收到钉钉消息后执行 `routeInboundMessage`：
   - 缓存 `sessionWebhook`（带过期时间）；
   - 提取文本内容；
   - 以 `Bearer ${GATEWAY_TOKEN}` 调本地网关 `/v1/chat/completions`；
   - 解析 SSE `data: ...` 增量，拼接 `delta.content`；
   - 通过 `sendTextMessage` 回传给钉钉。

关键实现特征：

- 网关地址固定 localhost，端口来自 `OPENCLAW_GATEWAY_PORT`（默认 3000）。
- 会话隔离键通过 `X-OpenClaw-Session-Key: dingtalk:<conversationId>:<senderStaffId>` 注入。
- 当前版本只启动一个账号的 Stream 连接（循环里 `break`），属于单活账号模型。

## 4. 入站链路：Stream 协议实现（src/stream.ts）

### 4.1 建连

- 向 `https://api.dingtalk.com/v1.0/gateway/connections/open` 发起 POST，参数含 `clientId`、`clientSecret`、`subscriptions`。
- 订阅内容包括：
  - `EVENT/*`
  - `CALLBACK:/v1.0/im/bot/messages/get`
- 返回 `endpoint + ticket` 后，通过 `endpoint?ticket=...` 建立 WebSocket。

### 4.2 帧处理与 ACK

- `PING_TOPIC` 或 `SYSTEM` 帧：直接 ACK。
- `CALLBACK + ROBOT_TOPIC`：解析 `frame.data` 为机器人消息对象，交给上层 `onMessage`，随后 ACK。
- 其他带 `messageId` 的帧：兜底 ACK。

ACK 结构固定为 `{ code: 200, message: "OK", data: "{\"response\":\"OK\"}" }`。

### 4.3 重连策略

- 建连失败或 WS 关闭后触发指数退避重连：`3s * 2^attempt`，上限 60s。
- `stop()` 将 `stopped = true` 并关闭 socket，阻断后续重连。

## 5. 出站链路：发送策略（src/send.ts）

### 5.1 目标地址模型

- `to` 支持两种格式：
  - `conversationId:staffId`（可命中会话 webhook）
  - `staffId`（直接按用户发）

### 5.2 一级路径：sessionWebhook

- 收到入站消息时缓存 `conversationId + senderStaffId -> webhook`。
- 回复时先查缓存，且校验 `expiredTime`，过期即清理。
- 命中后调用 webhook 发送 text 或 markdown。

### 5.3 二级路径：Robot OpenAPI

Webhook 不可用时回退：

1. 调 `/v1.0/oauth2/accessToken` 获取 token（`appKey=clientId`、`appSecret=clientSecret`）。
2. token 进程内缓存，TTL 预留 5 分钟安全边界。
3. 调 `/v1.0/robot/oToMessages/batchSend`，按 `msgKey + msgParam` 发送。

`msgKey` 当前映射：

- text -> `sampleText`
- markdown -> `sampleMarkdown`

## 6. Channel 插件抽象实现（src/channel.ts）

### 6.1 配置解析

- 从 `openclaw.json.channels.dingtalk.accounts` 读取账号。
- 默认账号 ID 为 `default`。
- 账号判定：
  - `configured = clientId && clientSecret`
  - `enabled = raw.enabled !== false`

### 6.2 能力声明

- `capabilities.chatTypes = ["direct", "channel"]`
- `outbound.deliveryMode = "direct"`

### 6.3 出站 API

- `sendText` -> `sendTextMessage`
- `sendMedia` 将 `text + mediaUrl` 拼成 markdown，再走 `sendMarkdownMessage`

两种发送都调用 `runtime.channel.activity.record(...)` 记出站活动。

## 7. 后端侧集成：如何被部署到实例

后端在实例插件部署阶段会尝试部署 dingtalk 插件：

1. `workspace_service._deploy_channel_plugin` 中调用 `deploy_dingtalk_channel_plugin`（失败非致命）。
2. `llm_config_service` 定义插件目录、需要复制的文件清单。
3. 将源码复制到实例 `.openclaw/extensions/openclaw-channel-dingtalk/`。
4. 修改 `openclaw.json`：
   - `plugins.load.paths` 注入绝对路径 `/root/.openclaw/extensions/openclaw-channel-dingtalk`
   - `plugins.entries.dingtalk = {"enabled": true}`
5. 完成后重启实例以加载插件。

此外，DingTalk 作为统一频道 schema 的一等公民已在后端注册字段（`clientId`、`clientSecret`、`robotCode`、`corpId`、策略项等），并且 OpenClaw/NanoBot 运行时都标记为支持（字段 runtime_key 存在差异映射）。

## 8. 配置与运行时数据流

### 8.1 配置来源

- 前端 Channel 配置页面写入后端。
- 后端写入实例运行时配置文件（OpenClaw 的 `openclaw.json`）。
- 插件在 `api.config` 中读取 `channels.dingtalk.accounts`。

### 8.2 消息闭环

1. 用户在钉钉发消息给机器人。
2. 钉钉 Stream 回调推送到插件 WebSocket。
3. 插件转发到本地 Gateway 进行模型推理。
4. 插件将结果回发到钉钉（Webhook 优先，API 回退）。

## 9. 设计优点与已知限制

### 9.1 优点

- 零运行时 npm 依赖，部署简单，规避安装阶段失败。
- 入站/出站链路分层清晰，send 与 stream 模块职责明确。
- Webhook + API 双路径提升送达鲁棒性。
- 重连策略具备指数退避，抗临时网络抖动。

### 9.2 限制与风险点

1. 单账号 Stream：当前只启动首个可用账号，多个账号不会并行监听。
2. token 缓存粒度：`cachedToken` 是模块级单例，若未来并行多账号可能串用 token。
3. 入站仅处理 text：非文本消息直接忽略。
4. SSE 解析简化：按换行切分，若 chunk 边界不规则可能漏解析极端分片。
5. 错误处理以日志为主：没有熔断、告警上报与可观测指标。
6. webhookStore 内存态：进程重启即丢失，会影响短期回复命中率。

## 10. 可演进建议（按优先级）

1. 多账号并发：改为 `Map<accountId, streamClient>`，全部启用账号各自建连。
2. token 按账号缓存：`Map<accountId, token>`，避免未来多账号串扰。
3. 入站过滤策略：落地 `dmPolicy/groupPolicy/allowFrom` 到 `routeInboundMessage`。
4. SSE 解析增强：引入稳健的 event-stream parser，处理跨 chunk 行拼接。
5. 可靠性增强：补充重试/熔断、发送失败死信、关键指标埋点（连接状态、ACK 延迟、发送成功率）。
6. 持久化 webhook：可选落地短 TTL KV（或 runtime cache service）。

## 11. 核心代码定位索引

- 插件入口与消息路由：`openclaw-channel-dingtalk/index.ts`
- Channel 接口实现：`openclaw-channel-dingtalk/src/channel.ts`
- Stream 协议实现：`openclaw-channel-dingtalk/src/stream.ts`
- 发送链路实现：`openclaw-channel-dingtalk/src/send.ts`
- 类型定义：`openclaw-channel-dingtalk/src/types.ts`
- 后端部署逻辑：`nodeskclaw-backend/app/services/llm_config_service.py`
- 实例部署触发点：`nodeskclaw-backend/app/services/workspace_service.py`
- 统一频道字段定义：`nodeskclaw-backend/app/services/unified_channel_schema.py`

