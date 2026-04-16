# Hermes Agent 作为第三种工作引擎（openclaw / nanobot / hermes）接入方案

更新时间：2026-04-16

## 1. 现状基线（NoDeskClaw 当前引擎抽象）

当前仓库里，openclaw 与 nanobot 的差异化能力，主要通过以下层实现：

- 运行时注册层：`RuntimeRegistry` 使用 `RuntimeSpec` 描述每个 runtime 的镜像仓库 key、配置路径、健康探针、是否可用、展示信息等。新增引擎的第一入口就在这里。  
- 配置适配层：`RuntimeConfigAdapter` 抽象读写配置、channel 字段映射、重启逻辑；目前只有 `OpenClawConfigAdapter` 与 `NanobotConfigAdapter`。  
- 镜像构建层：`nodeskclaw-artifacts/build.sh` 通过 `<engine>-image` 子目录构建镜像，并支持 `all` 模式串行构建。  
- 前端能力层：Portal 通过 `runtimeCapabilities` 与 `instanceFlow` 控制“基因、演化日志、LLM 配置”等 UI 能力开关和引擎说明卡片。  
- 版本目录层：后端 `engine_versions` API + seed 机制支持按 runtime 维护镜像版本，Create Instance 时按 runtime 拉取可选版本。

这意味着 Hermes 的接入不需要重写架构，只需要沿着当前“注册 + 适配 + 镜像 + UI”的既有抽象扩展第三个 runtime。

## 2. Hermes Agent 事实调研结论（基于官方仓库 / 官方文档）

### 2.1 Hermes 与 NoDeskClaw 兼容点

- Hermes 有 CLI 入口和 gateway 入口（`hermes` / `hermes gateway`），适配“单容器长驻 agent 进程”模式。  
- Hermes 文档明确支持把 gateway 作为统一消息入口，并可通过 API Server 暴露 OpenAI 兼容接口（`/v1/chat/completions`、`/v1/responses`）。  
- Hermes 官方提供 `hermes claw migrate`，说明其对 OpenClaw 生态迁移有直接兼容路径，这对 NoDeskClaw 现有 openclaw 用户迁移非常关键。  
- Hermes 默认数据根目录是 `~/.hermes`（可通过 `HERMES_HOME` 覆盖），与当前 NoDeskClaw 的 NFS 挂载模式（openclaw `.openclaw` / nanobot `.nanobot`）一致，可平滑接入。

### 2.2 Hermes 与 NoDeskClaw 差异点（需要设计决策）

- Hermes 不是“OpenClaw plugin SDK 兼容体”，现有 `openclaw-channel-*` 插件不可直接复用。  
- Hermes 功能更完整（memory/skills/gateway/platform adapters/API server），如果“一次性全开”会明显增加接入复杂度。  
- Hermes 运行依赖偏 Python 生态，镜像构建链路应更接近 nanobot，而不是 openclaw（Node 主导）。

## 3. 总体设计：两阶段接入（建议）

## 阶段 A（MVP，上线优先）

目标：先把 Hermes 作为“可创建、可启动、可健康检查、可基础对话”的第三引擎接进平台。

边界：
- 暂不接入 Hermes 原生消息平台编排（Telegram/Discord 等）配置面板；
- 暂不做 Hermes 原生技能/记忆可视化管理；
- 仅保留基础实例生命周期、文件管理、日志、通道配置最小可用子集。

## 阶段 B（增强期，能力对齐）

目标：逐步对齐 openclaw/nanobot 的运营能力。

- Hermes 通道配置模型化（复用 unified channel schema 并增加 hermes key mapping）；
- Hermes 专属能力（profiles、API server、多平台 gateway）进入 Portal；
- 基因/技能安装适配器从 noop 升级为 HermesGeneInstallAdapter（写入 `~/.hermes/skills` + 配置 patch）。

## 4. 详细落地改造点（按模块）

## 4.1 后端：RuntimeRegistry 扩展

文件：`nodeskclaw-backend/app/services/runtime/registries/runtime_registry.py`

新增 `RuntimeSpec(runtime_id="hermes")`，建议参数如下：

- `display_name`: “自进化工作引擎”
- `display_description`: “支持多平台网关、技能自演进与 API Server”
- `display_powered_by`: `Hermes Agent`
- `order`: 建议 `1`（放在 openclaw 与 nanobot 之间）
- `image_registry_key`: `image_registry_hermes`
- `config_rel_path`: `.hermes/config.yaml`（或最终确认后的 Hermes 主配置文件路径）
- `data_dir_container_path`: `/root/.hermes`
- `supports_channel_plugins`: `False`（先关闭 OpenClaw 插件安装入口）
- `gateway_port`: 与现有 18789/18790 错开，例如 `18791`
- `health_probe_path`: 优先使用 Hermes API 健康端点（若启用 API server 可用 `/health`）
- `available`: 初期可设 `False`（灰度），验证后改 `True`

## 4.2 后端：配置适配器新增 HermesConfigAdapter

文件：`nodeskclaw-backend/app/services/runtime/config_adapter.py`

新增 `HermesConfigAdapter(RuntimeConfigAdapter)`，实现原则：

- `read_config/write_config`：读写 `.hermes/config.yaml`（YAML，不是 JSON）
- `extract_channels/merge_channels`：先最小实现（可返回空或透传 `gateway.platforms` 子树）
- `restart`：复用 `_restart_container`（与 nanobot 一致）
- `supported_channels`：先返回 `[]` 或 Hermes MVP 支持的少量通道
- `translate_to_runtime/translate_from_runtime`：先 noop，后续阶段 B 再对齐 schema

并将 `_ADAPTERS` 扩展为：`openclaw` / `nanobot` / `hermes`。

## 4.3 后端：镜像仓库与版本目录

- `DEFAULT_REGISTRY_CONFIGS` 新增 `image_registry_hermes` 默认值（对应 Hermes 镜像仓库）。
- `engine_versions` 现有模型可直接复用，不需要新表。
- `seed_engine_versions` 已按 runtime 聚合，天然兼容 `hermes`，无需改算法。

## 4.4 构建系统：新增 hermes 镜像流水线

目录与脚本：
- 新增 `nodeskclaw-artifacts/hermes-image/`（`Dockerfile`、`docker-entrypoint.sh`、配置模板）
- 修改 `nodeskclaw-artifacts/build.sh`：
  - `detect_latest_version()` 增加 hermes 源（建议 PyPI 包或 Git tag 二选一）
  - `all` 模式循环从 `openclaw nanobot` 扩展到 `openclaw hermes nanobot`
  - `verify` 分支新增 hermes 版本自检命令

镜像策略建议：
- 基础镜像走 Python slim；
- `pip install hermes-agent==${HERMES_VERSION}`；
- 容器内固定 `HERMES_HOME=/root/.hermes`；
- entrypoint 负责首次模板渲染 + 启动 `hermes gateway`。

## 4.5 部署服务：runtime=hermes 的路径贯通

重点检查：`nodeskclaw-backend/app/services/deploy_service.py` 与 compute provider 实现。

目标：
- 选择 hermes 镜像 tag；
- 注入 hermes 所需 env（如 API key、gateway token、HERMES_HOME 等）；
- 挂载 `/root/.hermes` 到 PVC；
- 探针改用 Hermes 可用健康路径。

## 4.6 前端（Portal）：引擎选择与能力映射

文件：
- `nodeskclaw-portal/src/utils/runtimeCapabilities.ts`
- `nodeskclaw-portal/src/utils/instanceFlow.ts`
- `nodeskclaw-portal/src/views/CreateInstance.vue`
- `nodeskclaw-portal/src/views/InstanceChannels.vue`

改造点：
- 新增 `hermes` 能力矩阵；
- 引擎卡片新增 Hermes 文案（通过 i18n key，不写硬编码中文）；
- Channel 页面中“OpenClaw 专属插件安装”入口对 Hermes 继续隐藏；
- 创建实例时 runtime 下拉支持 `hermes`，并拉取对应 `engine_versions?runtime=hermes`。

## 4.7 基因/技能安装策略（关键设计）

当前 openclaw 有专门 `OpenClawGeneInstallAdapter`，nanobot 是 noop。

Hermes 建议采用“先 noop，后增强”：

- 阶段 A：先挂 `NoopGeneInstallAdapter`，保证主链路可用；
- 阶段 B：新增 `HermesGeneInstallAdapter`：
  - 将基因 skill 渲染为 Hermes 技能文档并写入 `~/.hermes/skills/`；
  - 将工具白名单映射到 Hermes tools/toolsets 配置；
  - 支持 runtime config patch（YAML merge）；
  - 补充冲突处理与回滚策略。

## 5. 与现有 OpenClaw / Nanobot 的复用关系

可直接复用：
- RuntimeRegistry / EngineVersion / ComputeProvider / 文件管理主流程。

需要新实现：
- HermesConfigAdapter；
- Hermes 镜像目录与 entrypoint；
- Hermes 运行时能力矩阵与前端文案。

明确不复用：
- OpenClaw Channel Plugin（`openclaw-channel-*`）机制。

## 6. 风险清单与规避

1. 配置格式风险（JSON vs YAML）  
   - 规避：Hermes adapter 单独走 YAML parser，不复用 JSON 逻辑。

2. 健康探针不一致风险  
   - 规避：镜像内强制开启 Hermes API server，统一用 HTTP probe；否则降级为进程探针。

3. 通道能力错配风险  
   - 规避：阶段 A 先不暴露 Hermes 多平台配置，避免 UI 提供但运行时不生效。

4. 镜像体积与启动时长风险  
   - 规避：拆分 base / security 镜像，先保证 base 最小化依赖。

## 7. 建议实施顺序（可直接拆任务）

1. 后端 runtime 注册 + adapter 框架（不改前端）  
2. hermes-image 与 build.sh 支持，能本地构建/启动  
3. deploy_service 贯通，K8s 可拉起实例  
4. `/engines` 与 Portal 引擎卡片显示 Hermes  
5. CreateInstance 全流程可创建 Hermes 实例  
6. 灰度发布（`available=false` -> `true`）  
7. 阶段 B：技能安装与多平台网关配置

## 8. 验收标准（MVP）

- 管理后台可看到 Hermes 引擎卡片；
- `engine-versions` 可维护 `runtime=hermes`；
- 实例创建后 Pod 就绪，健康检查通过；
- Portal 可查看日志、文件、基础状态；
- 不影响 openclaw / nanobot 现有链路。

## 9. 关键外部依据（官方来源）

- Hermes 官方仓库：<https://github.com/NousResearch/hermes-agent>
- 架构文档（AIAgent / gateway / API server 拓扑）：<https://hermes-agent.nousresearch.com/docs/developer-guide/architecture/>
- Messaging / gateway 命令：<https://hermes-agent.nousresearch.com/docs/user-guide/messaging/>
- Open WebUI + API server（含 `/v1/chat/completions` 与 `/v1/responses`）：<https://hermes-agent.nousresearch.com/docs/user-guide/messaging/open-webui>

