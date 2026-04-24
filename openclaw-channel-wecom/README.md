# openclaw-channel-wecom

OpenClaw Channel 插件 -- 通过企业微信机器人 WebSocket 协议收发消息。

## 功能

- 通过企业微信机器人 WebSocket 长连接接收消息（单聊 + 群聊）
- 入站消息转发到 OpenClaw Gateway 生成回复
- 优先通过会话 `response_url` 被动回复
- 支持 text / markdown 回复

## 配置

在 OpenClaw 的 `openclaw.json` 中配置 `channels.wecom`：

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "default": {
          "botId": "your-bot-id",
          "secret": "your-bot-secret",
          "enabled": true
        }
      }
    }
  }
}
```

可选字段：

- `websocketUrl`：WebSocket 地址，默认 `wss://openws.work.weixin.qq.com`
- `corpId`、`corpSecret`、`agentId`：用于主动发送回退
