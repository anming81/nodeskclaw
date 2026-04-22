# 企业微信（WeCom）频道插件设计方案（对齐 openclaw-channel-dingtalk 机制）

## 1. 目标与范围

目标：在 NoDeskClaw 中新增内置 `wecom`（企业微信）频道插件，优先支持智能机器人长连接模式（WebSocket），并在实例「Channel」页面提供图形化配置。

范围分两层：

1. NoDeskClaw 后端与前端：负责插件部署、配置写入、字段校验、UI 配置体验。
2. OpenClaw 频道插件：负责与企业微信智能机器人长连接协议对接、消息收发和会话路由。

本设计严格复用当前 `openclaw-channel-dingtalk` 的部署与运行机制，保持一致的维护模型。

## 2. 现状拆解：DingTalk 插件机制

### 2.1 插件部署链路（NoDeskClaw 后端）

1. `workspace_service._deploy_channel_plugin` 在工作区 Agent 加入实例时触发 `deploy_dingtalk_channel_plugin`。  
2. `llm_config_service` 定义了 `DINGTALK_PLUGIN_DIR`、文件白名单、注入逻辑 `_inject_dingtalk_plugin_path`。  
3. 部署时把仓库目录 `openclaw-channel-dingtalk` 复制到实例 `.openclaw/extensions/openclaw-channel-dingtalk`，并写入 `.plugin-hash` 用于后续自动同步。  
4. 同时向 `openclaw.json` 写入 `plugins.load.paths` 和 `plugins.entries.dingtalk.enabled=true`，确保 OpenClaw 启动时自动加载插件。

结论：NoDeskClaw 的“内置频道插件”是仓库内源码复制 + 配置注入模型，不依赖在线 npm 安装。

### 2.2 Channel 配置链路（NoDeskClaw 后端 + 前端）

1. `unified_channel_schema.py` 提供 canonical 字段定义（包含 dingtalk 字段、标签、默认值、适用 runtime）。  
2. `channel_config_service` 在 `available-channels` 接口返回 schema，前端按 schema 自动渲染表单。  
3. 保存时经 `write_channel_configs` 写入 `channels.<id>` 配置，并触发 runtime 重启。

结论：新增 `wecom` 最低成本方案是补齐 unified schema 与 runtime 支持列表，不需要单独开发复杂表单组件。

### 2.3 dingtalk 插件运行机制（OpenClaw 侧）

1. `index.ts` 在 `register()` 中注册 channel，然后读取账号并启动 `DingTalkStreamClient`。  
2. `stream.ts` 通过 HTTP 先拿 `endpoint+ticket`，再用 WebSocket 长连接，处理 ping/callback，消息 ACK。  
3. 入站消息经 `routeInboundMessage()` 转发到网关 `/v1/chat/completions`（SSE 流式），拼接结果后回发。  
4. 出站消息优先 `sessionWebhook`，失效后回退 Robot API（`send.ts`）。

结论：这是“单插件内自管长连接 + 网关转发 + 双通道回发”模式，正好可作为 wecom 最小可用实现模板。

## 3. WeCom 方案总览（MVP）

### 3.1 设计原则

1. 先实现智能机器人长连接（WebSocket）闭环，不做 Agent/XML webhook。  
2. 配置结构与 dingtalk 对齐：`channels.wecom.accounts.<accountId>`。  
3. 单账号先落地（默认 `default`），多账号能力保留结构兼容。  
4. 保持“零安装依赖”优先，避免实例内 `npm install`。

### 3.2 目标配置结构

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "default": {
          "enabled": true,
          "botId": "...",
          "secret": "...",
          "websocketUrl": "wss://openws.work.weixin.qq.com",
          "dmPolicy": "open",
          "groupPolicy": "mention",
          "allowFrom": []
        }
      }
    }
  }
}
```

字段说明（MVP）：

- `botId`：机器人 ID（长连接鉴权主键）
- `secret`：机器人密钥（长连接鉴权）
- `websocketUrl`：可选，默认官方地址
- `enabled`：账号开关
- `dmPolicy/groupPolicy/allowFrom`：消息准入策略（先做配置透传，后续细化）

## 4. OpenClaw 插件设计（openclaw-channel-wecom）

目录结构完全镜像 `openclaw-channel-dingtalk`：

- `openclaw-channel-wecom/index.ts`
- `openclaw-channel-wecom/openclaw.plugin.json`
- `openclaw-channel-wecom/src/channel.ts`
- `openclaw-channel-wecom/src/runtime.ts`
- `openclaw-channel-wecom/src/stream.ts`
- `openclaw-channel-wecom/src/send.ts`
- `openclaw-channel-wecom/src/types.ts`

### 4.1 channel.ts（插件契约层）

职责：

1. 解析 `channels.wecom.accounts`。
2. 账号解析函数返回 `ResolvedWeComAccount`（configured/enabled）。
3. 实现 `outbound.sendText`、`outbound.sendMedia`。
4. status 快照输出。

### 4.2 stream.ts（长连接层）

职责：

1. 按企业微信长连接协议获取连接参数（ticket/session）。
2. 建立 WebSocket。
3. 处理系统心跳与事件回调。
4. 消息 ACK。
5. 断线指数退避重连。

协议细节待按官方文档 `path/101463` 对齐，重点确认：

- 开连接接口路径与鉴权 Header
- WebSocket 帧格式（type/topic/messageId）
- 心跳与 ACK 的字段要求
- 断线错误码与重试策略建议

### 4.3 index.ts（注册与路由层）

职责：

1. `api.registerChannel()` 注册 `wecom`。
2. 选择一个可用账号启动 `WeComStreamClient`。
3. 入站消息转换后调用本地 gateway：
   - URL：`http://localhost:${OPENCLAW_GATEWAY_PORT}/v1/chat/completions`
   - Header：`Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}`
   - Header：`X-OpenClaw-Session-Key: wecom:<chatId>:<senderId>`
4. 读取 SSE 增量并拼装完整文本后回发。

### 4.4 send.ts（回发层）

职责：

1. 优先使用会话级回调地址（若 WeCom 长连接事件携带会话回调信息）。
2. 回退企业微信主动发消息 API（需 access_token 缓存）。
3. 统一 `sendTextMessage` / `sendMarkdownMessage` 返回格式：`{ channel, messageId }`。

### 4.5 types.ts（类型层）

定义：

- `WeComAccountConfig`
- `ResolvedWeComAccount`
- `WeComStreamEndpoint`
- `WeComInboundMessage`
- `WeComStreamFrame`
- `SessionReplyEntry`

## 5. NoDeskClaw 后端改造设计

### 5.1 llm_config_service.py

新增一组与 dingtalk 同构的常量与函数：

1. `WECOM_PLUGIN_DIR = "openclaw-channel-wecom"`
2. `WECOM_PLUGIN_FILES = (...)`
3. `_get_wecom_plugin_source_dir()`
4. `_deploy_wecom_plugin_files()`
5. `_inject_wecom_plugin_path(config)`
6. `deploy_wecom_channel_plugin(instance, db)`
7. `CHANNEL_PLUGIN_REGISTRY["wecom"] = ChannelPluginSpec(...)`

目的：让 wecom 插件具备自动部署与 hash 自动同步能力。

### 5.2 workspace_service.py

在 `_deploy_channel_plugin()` 中新增 `deploy_wecom_channel_plugin` 调用，和 dingtalk 一样走“部署后统一重启”流程。

### 5.3 unified_channel_schema.py

新增 `wecom` 的 `ChannelDefinition`（openclaw/nanobot 均可先标注为 supported，若 nanobot 未实现则只映射 openclaw）。

建议字段（openclaw runtime_key）：

- `botId`
- `secret`
- `websocketUrl`（default）
- `connectionMode`（default=`websocket`，先只暴露 websocket）
- `allowFrom`
- `dmPolicy`
- `groupPolicy`

### 5.4 runtime/config_adapter.py

`OpenClawConfigAdapter.supported_channels()` 增加 `wecom`，使前端可判定 runtime 支持。

## 6. NoDeskClaw 前端改造设计

### 6.1 i18n 文案

在 `zh-CN.ts` / `en-US.ts` 增加 wecom 字段标签：

- wecomBotId
- wecomSecret
- wecomWebsocketUrl
- wecomConnectionHint

### 6.2 InstanceChannels 页面

无需新增专用组件，沿用 schema 动态渲染；只需保证新增字段在 i18n 中可读、placeholder 清晰。

### 6.3 交互策略

1. 用户填入 `botId + secret` 后保存。
2. 后端写入配置并重启实例。
3. 前端提示“已保存并触发重启，长连接需等待进程拉起”。

## 7. 与 wecom-openclaw-plugin 的对齐与取舍

对齐点：

1. 使用 `wecom` 作为 channel id。
2. 优先支持 WebSocket 长连接。
3. 账号化配置结构（支持多账号扩展）。

MVP 取舍：

1. 暂不实现 Agent 模式（XML 回调、加解密、签名校验）。
2. 暂不引入其 MCP tool 与 skills。
3. 暂不引入复杂多媒体能力（文件上传、语音转写、卡片互动）。

理由：先打通 NoDeskClaw 内置插件链路和核心问答闭环，后续按版本迭代。

## 8. 安全与稳定性设计

1. 凭据脱敏：沿用 `SENSITIVE_KEYS`，新增 `botId/secret` 相关键。  
2. 重连策略：指数退避 + 上限，避免短时抖动风暴。  
3. 消息去重：按 `msgId` 做短时缓存去重，防止重复回调。  
4. 限流：单会话并发回复上限，避免网关被刷爆。  
5. 降级：长连接不可用时记录状态并告警，不影响实例其他 channel。

## 9. 实施阶段划分

### Phase 1：设计冻结与协议确认

1. 确认 `path/101463` 中长连接开链、心跳、ACK、消息体字段。
2. 确认最小主动发消息 API。
3. 固化 `wecom` 字段字典。

### Phase 2：后端与前端接入

1. 新增 wecom schema。
2. 新增 wecom 插件部署能力。
3. UI 增加 wecom 表单字段。

### Phase 3：插件实现

1. 新建 `openclaw-channel-wecom`。
2. 完成长连接接收与 gateway 转发。
3. 完成文本回发与 token 缓存。

### Phase 4：联调与验收

1. Docker runtime 单实例联调。
2. 异常注入（断网、401、重连、重启）。
3. 回归 dingtalk/feishu 配置链路不受影响。

## 10. 验收标准（MVP）

1. 在实例 Channel 页面可看到并配置 `wecom`。  
2. 保存后 `openclaw.json` 出现 `channels.wecom.accounts.default`。  
3. `.openclaw/extensions/openclaw-channel-wecom` 被成功部署。  
4. OpenClaw 启动后能建立企业微信长连接。  
5. 用户在企业微信发消息可触发 OpenClaw 回复（文本）。

## 11. 风险清单

1. 官方协议字段变动导致连接失败。  
2. 企业网络对 WebSocket 出口限制。  
3. 会话标识映射不当导致串会话。  
4. 官方限流或风控导致发送失败。

对应策略：

- 在插件日志打印关键上下文（不含密钥）。
- 暴露 `websocketUrl` 可配置，支持后续代理网关。
- 统一错误码与重试策略，便于运营排障。

## 12. 下一步

进入开发前只需补一次协议核对清单（基于企业微信官方长连接文档），确认 ACK 与主动消息 API 的最终字段，即可按 dingtalk 同构模板快速落地。
