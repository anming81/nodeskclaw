# DeskClaw 实例内置企业微信插件（openclaw-channel-wecom）设计方案

## 1. 背景与目标

当前 NoDeskClaw 已内置并自动部署 `openclaw-channel-dingtalk` 插件，流程包括：

- 插件源码随后端镜像打包
- 实例创建/绑定工作区时自动复制插件文件到实例目录
- 自动更新实例 `openclaw.json` 的 `plugins.load.paths` 和 `plugins.entries`
- 由统一 Channel Schema 驱动前端图形化表单

本方案目标是在不破坏既有通道能力的前提下，新增 `openclaw-channel-wecom`，并支持在 NoDeskClaw 图形化页面直接配置企业微信机器人。

## 2. 现状基线（可复用能力）

### 2.1 后端插件部署链路

后端已对钉钉实现了完整的插件部署链路，可直接复用模板：

1. 在 `llm_config_service.py` 中声明插件目录、文件清单、source_dir 检测、部署与配置注入函数。
2. 在 `CHANNEL_PLUGIN_REGISTRY` 注册，使自动 hash 同步机制生效。
3. 在 `workspace_service.py` 的 `_deploy_channel_plugin` 中执行部署。

### 2.2 Channel 配置与 UI Schema 链路

后端通过 `UNIFIED_CHANNEL_REGISTRY` 定义字段，前端按 schema 动态渲染。已有钉钉 schema 可作为企业微信字段设计模板。

### 2.3 自动发现仓库插件能力

`channel_config_service.py` 已支持扫描 `openclaw-channel-*` 目录并读取 `openclaw.plugin.json` 自动发现插件。

## 3. 总体实现策略

## 3.1 采用“源码内置 + 自动复制”而不是“实例内 npm install”

推荐与钉钉保持一致：

- 将 `openclaw-channel-wecom` 作为仓库一级目录（与 `openclaw-channel-dingtalk` 同级）
- 后端通过 RemoteFS 将必要文件复制到实例 `/root/.openclaw/extensions/openclaw-channel-wecom`
- 将路径写入实例 `openclaw.json`

理由：

- 与现有架构一致，运维复杂度最低
- 避免在实例容器里执行 npm install 带来的网络/依赖不确定性
- 可复用现有 hash 同步与热更新流程

## 3.2 插件来源策略

考虑 `wecom-openclaw-plugin` 基于 `@wecom/aibot-node-sdk`，存在依赖安装需求，分两种可落地路径：

### 路径 A（优先）：Fork/裁剪为“免安装依赖”版本

- 参考钉钉插件策略，将关键协议调用改成 Node 原生 `fetch` + `WebSocket` 或最小 vendored 代码
- 保持插件目录内仅源码文件可运行，不依赖 runtime `npm install`

优点：部署确定性高，符合当前 NoDeskClaw 的插件投放方式。
缺点：与官方仓库存在维护分叉，后续升级需人工同步。

### 路径 B：预构建产物内置（dist + node_modules）

- 在 CI 构建阶段打包 `dist/` 和生产依赖
- 后端复制产物目录到实例

优点：尽量复用官方实现，功能完整。
缺点：镜像体积明显增加，依赖兼容风险高，升级回归成本较高。

建议先采用路径 A 的“最小可用子集（MVP）”，优先交付机器人消息收发与图形化配置；高级能力（MCP、技能、媒体处理、Agent 模式）分阶段增加。

## 4. 目标能力拆分（分阶段）

### Phase 1（MVP，2~4 天）

- 仅 Bot 模式 WebSocket 收发
- 支持单账号配置：`botId`、`secret`、`enabled`
- 支持 DM + 群聊@机器人
- 支持基础文本回复（对接网关 `v1/chat/completions`）
- 复用现有会话 key 规范：`wecom:<conversationId>:<senderId>`

### Phase 2（增强，3~5 天）

- 支持多账号（`accounts`）
- 增加访问控制：`dmPolicy`、`allowFrom`、`groupPolicy`、`groupAllowFrom`
- 增加消息发送兜底与重试策略
- 补充状态快照和 activity 埋点

### Phase 3（高级，按需）

- Webhook 模式（token + encodingAESKey）
- 媒体消息收发
- 模板卡片
- Agent 模式
- wecom_mcp 工具桥接

## 5. 详细改造点

### 5.1 新增插件目录（仓库根目录）

新增 `openclaw-channel-wecom/`，结构对齐钉钉：

- `index.ts`
- `openclaw.plugin.json`
- `package.json`
- `src/channel.ts`
- `src/runtime.ts`
- `src/types.ts`
- `src/stream.ts`（或 `client.ts`）
- `src/send.ts`

MVP 保持最小文件集，后续再扩展 webhook/media 相关模块。

### 5.2 后端部署链路改造

在 `nodeskclaw-backend/app/services/llm_config_service.py` 复制钉钉实现范式新增：

- `WECOM_PLUGIN_DIR`
- `WECOM_PLUGIN_FILES`
- `_get_wecom_plugin_source_dir()`
- `_deploy_wecom_plugin_files()`
- `_inject_wecom_plugin_path()`
- `deploy_wecom_channel_plugin()`
- 在 `CHANNEL_PLUGIN_REGISTRY` 注册 `wecom`

在 `workspace_service.py` 的 `_deploy_channel_plugin()` 追加：

- 尝试部署 wecom 插件（异常记录 warning，不中断主流程）

在 `Dockerfile` 追加：

- `COPY openclaw-channel-wecom/ ./openclaw-channel-wecom/`

### 5.3 Channel Schema 与图形化配置

在 `unified_channel_schema.py` 新增 `wecom` 定义，MVP 字段建议：

- `botId`（必填）
- `secret`（必填，password）
- `enabled`（可选，默认 true）
- `dmPolicy`（open/allowFrom/disabled）
- `allowFrom`（string_list）
- `groupPolicy`（mention/open/allowlist/disabled）
- `groupAllowFrom`（string_list）

注意：

- 字段键名优先与官方插件配置路径一致，降低未来兼容成本
- 文案走 i18n 词条，避免新增硬编码中文文案

### 5.4 运行时适配

`config_adapter.py` 里 NanoBot 已包含 `wecom`，OpenClaw `supported_channels()` 尚无 `wecom`。需补齐以保证一致显示与可配置性。

### 5.5 安全与脱敏

在 `channel_config_service.py` 的敏感字段集合确保包含：

- `secret`
- `encodingAESKey`（若后续启用 webhook）
- `token`（若 webhook 作为认证用途）

### 5.6 OpenClaw 配置注入规范

部署后在实例配置生成：

- `plugins.load.paths += /root/.openclaw/extensions/openclaw-channel-wecom`
- `plugins.entries.wecom.enabled = true`
- `channels.wecom`（按 schema 保存账户配置）

## 6. 配置模型建议

MVP 推荐先单账号扁平配置，后续平滑升级到多账号：

### MVP（单账号）

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "botId": "xxx",
      "secret": "xxx",
      "dmPolicy": "open",
      "groupPolicy": "mention"
    }
  }
}
```

### 目标形态（多账号）

```json
{
  "channels": {
    "wecom": {
      "accounts": {
        "default": {
          "enabled": true,
          "botId": "xxx",
          "secret": "xxx",
          "dmPolicy": "open",
          "groupPolicy": "mention"
        }
      }
    }
  }
}
```

## 7. 与官方插件对齐边界

优先对齐：

- channel id：`wecom`
- 核心配置键：`botId` / `secret` / `connectionMode`
- 策略键：`dmPolicy` / `allowFrom` / `groupPolicy`

暂不在 MVP 对齐：

- Agent 模式 XML 加密回调
- 模板卡片与复杂媒体管线
- wecom_mcp 与 skills 体系

## 8. 测试与验收清单

### 8.1 后端单元测试

- 插件 source dir 存在/缺失分支
- `openclaw.json` 注入路径幂等性（重复执行不重复添加）
- `CHANNEL_PLUGIN_REGISTRY` hash 变更检测
- schema 输出正确（required/default/options/runtime_key）

### 8.2 集成测试（Docker 实例）

- 新建 OpenClaw runtime 实例后，确认插件目录已复制
- 确认 `openclaw.json` 出现 wecom plugin path 与 entry
- 在 UI 保存 wecom 配置后，实例可读到 `channels.wecom`
- 企业微信发送消息后，能回到 OpenClaw 网关并成功回复

### 8.3 回归测试

- 钉钉插件不受影响（部署、配置、收发）
- nodeskclaw/learning 插件不受影响
- 非 OpenClaw runtime 不执行 wecom 部署

## 9. 风险与规避

1. 依赖不可用风险：
   - 风险：`@wecom/aibot-node-sdk` 在“纯文件复制部署”模式下无法解析依赖。
   - 规避：MVP 先做免安装依赖实现，或在构建期固化依赖产物。

2. OpenClaw 版本兼容风险：
   - 风险：官方插件标注最低版本要求。
   - 规避：在 `CHANNEL_PLUGIN_REGISTRY.min_openclaw_version` 设置门槛，并在不满足时跳过部署+给出可见告警。

3. 配置键不兼容风险：
   - 风险：NoDeskClaw 字段命名与官方插件配置路径不一致。
   - 规避：统一以官方键命名，避免后续迁移成本。

4. 多账号复杂度风险：
   - 风险：MVP 直接上多账号会增加 UI 与路由复杂度。
   - 规避：先单账号，预留 `accounts.default` 升级路径。

## 10. 推荐落地顺序

1. 新建 `openclaw-channel-wecom`（MVP 收发）。
2. 后端加 wecom 插件部署函数 + registry + Dockerfile copy。
3. 增加 `unified_channel_schema` 的 wecom 字段并完成 i18n。
4. 补 `config_adapter` 的 OpenClaw supported_channels。
5. 完成单元+集成测试。
6. 再扩展 webhook/媒体/agent/mcp 高级能力。

## 11. 需要你确认的设计决策

1. **插件实现策略**：优先选路径 A（免安装依赖）还是路径 B（预构建产物）。
2. **MVP 范围**：是否同意先只做 Bot WebSocket + 文本收发。
3. **账号模型**：首版单账号还是直接多账号。
4. **版本策略**：是否对 OpenClaw 版本设置最小门槛并在 UI 提示。

确认后我再按该方案进入代码实现阶段。
