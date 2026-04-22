# openclaw-channel-wecom

OpenClaw Channel 插件 —— 通过企业微信智能机器人长连接（WebSocket）收发消息。

## 配置

在 OpenClaw 的 `openclaw.json` 中配置 `channels.wecom`：

```json
{
  "channels": {
    "wecom": {
      "botId": "your-bot-id",
      "secret": "your-secret",
      "enabled": true,
      "websocketUrl": "wss://openws.work.weixin.qq.com"
    }
  }
}
```

插件也兼容 `accounts` 多账号结构。

## 协议行为

- 建立 WebSocket 后发送 `aibot_subscribe`（`bot_id` + `secret`）完成订阅。
- 每 30 秒发送 `ping` 保活。
- 接收 `aibot_msg_callback` / `aibot_event_callback` 并路由到 OpenClaw gateway。
- 回包优先走 `aibot_respond_msg`（命中 `req_id`），否则走 `aibot_send_msg`。

## 说明

- 插件由 NoDeskClaw 后端自动部署到 `.openclaw/extensions/openclaw-channel-wecom/`。
- 保存 Channel 配置后实例会重启并重新建立长连接。
- 凭证请通过实例配置界面填写，不要写入仓库。
