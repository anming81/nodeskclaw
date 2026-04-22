# openclaw-channel-wecom

OpenClaw Channel 插件 —— 通过企业微信智能机器人长连接（WebSocket）收发消息。

## 配置

在 OpenClaw 的 `openclaw.json` 中配置 `channels.wecom`：

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "default": {
          "botId": "your-bot-id",
          "secret": "your-secret",
          "enabled": true,
          "websocketUrl": "wss://openws.work.weixin.qq.com"
        }
      }
    }
  }
}
```

## 说明

- 插件由 NoDeskClaw 后端自动部署到 `.openclaw/extensions/openclaw-channel-wecom/`。
- 保存 Channel 配置后实例会重启并重新建立长连接。
- 凭证请通过实例配置界面填写，不要写入仓库。
