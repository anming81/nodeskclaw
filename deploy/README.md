# deploy/ — CI/CD 构建部署工具

DeskClaw 前后端的镜像构建、推送和 K8s 部署更新，统一通过 `cli.sh` 管理。

## 目录结构

```
deploy/
├── cli.sh            # 统一部署 CLI（唯一入口）
├── .env.local        # 本地部署配置（不进 git）
├── k8s/
│   ├── backend.yaml  # 后端 Deployment + Service
│   ├── admin.yaml    # Admin 前端 Deployment + Service
│   ├── portal.yaml   # Portal 前端 Deployment + Service
│   └── ingress.yaml  # Ingress（需手动配置域名后 apply）
└── README.md
```

## 部署架构

四个独立镜像，各自有 Deployment + ClusterIP Service：

| 组件 | 镜像名 | 端口 | 说明 |
|------|--------|------|------|
| backend | `nodeskclaw-backend` | 8000 | FastAPI，处理 API + SSE |
| admin | `nodeskclaw-admin` | 80 | Nginx，Admin 前端，反代 `/api` `/stream` 到 backend |
| portal | `nodeskclaw-portal` | 80 | Nginx，Portal 前端，反代 `/api` 到 backend |
| proxy | `nodeskclaw-llm-proxy` | 8080 | FastAPI，LLM 代理 |

K8s YAML 清单不包含 `namespace` 字段，由 `kubectl -n <NS>` 在运行时指定目标 Namespace。

## 前置配置

创建 `deploy/.env.local`（已被 `.gitignore` 忽略）：

```bash
# deploy/.env.local
REGISTRY="<YOUR_REGISTRY>/<YOUR_NAMESPACE>"
KUBE_CONTEXT="<YOUR_KUBECTL_CONTEXT>"
```

其他前提：

- Docker Desktop 运行中
- 已登录容器镜像仓库：`docker login <YOUR_REGISTRY>`
- `kubectl` 已配置正确的集群上下文
- 目标 Namespace 和 `cr-pull-secret` 已存在
- `gh` CLI 已安装并认证（`release` 命令需要）

## 用法

### 日常部署（默认 staging）

```bash
./deploy/cli.sh deploy                # 全部组件（backend + admin + portal + proxy）
./deploy/cli.sh deploy backend        # 只部署后端
./deploy/cli.sh deploy admin          # 只部署 Admin 前端
./deploy/cli.sh deploy portal         # 只部署 Portal 前端
./deploy/cli.sh deploy proxy          # 只部署 LLM Proxy
./deploy/cli.sh deploy --skip-proxy   # 全部组件但跳过 proxy
```

### 部署到生产

```bash
./deploy/cli.sh deploy --prod         # 需交互确认
```

### 构建控制

```bash
./deploy/cli.sh deploy --build-only               # 仅构建+推送，不更新 K8s
./deploy/cli.sh deploy --deploy-only --tag v0.5.0  # 仅更新 K8s（用已有镜像）
./deploy/cli.sh deploy --no-cache                  # 不使用 Docker 缓存
./deploy/cli.sh deploy --tag v0.5.0-beta.1         # 指定镜像标签
```

### 版本发布

```bash
# 1. 构建并部署到 staging（指定版本标签）
./deploy/cli.sh deploy --tag v0.5.0-beta.1

# 2. 测试通过后，构建 CE 公开镜像 + 打 tag + 创建 GitHub Pre-release（不含 admin 和 ee/ 代码）
./deploy/cli.sh release v0.5.0-beta.1

# 3. 将 staging 验证过的镜像推到生产
./deploy/cli.sh promote v0.5.0-beta.1
```

### 首次初始化

```bash
./deploy/cli.sh init                               # 默认 staging，使用 nodeskclaw-backend/.env
./deploy/cli.sh init --env-file path/to/.env        # 指定 .env 文件
./deploy/cli.sh init --prod                         # 初始化生产环境
```

初始化后需手动配置 Ingress 域名并 apply：

```bash
kubectl --context <CTX> -n <NS> apply -f deploy/k8s/ingress.yaml
```

### 覆盖默认值

```bash
./deploy/cli.sh deploy --context other-cluster      # 覆盖默认 K8s 上下文
./deploy/cli.sh deploy --staging                    # 显式指定 staging（默认行为）
```

## 镜像标签格式

- 日常更新：`YYYYMMDD-<git-short-hash>`（如 `20260218-b0f6ad1`）
- 版本发布：语义化版本（如 `v0.1.0-beta.1`、`v0.1.0`）

## Dockerfile 位置

| 组件 | Dockerfile | Nginx 配置 |
|------|-----------|------------|
| backend | `nodeskclaw-backend/Dockerfile` | -- |
| admin | `ee/nodeskclaw-frontend/Dockerfile` | `ee/nodeskclaw-frontend/nginx.conf` |
| portal | `nodeskclaw-portal/Dockerfile` | `nodeskclaw-portal/nginx.conf` |
| proxy | `nodeskclaw-llm-proxy/Dockerfile` | -- |

## CE/EE 构建差异

`cli.sh` 自动检测项目根目录下是否存在 `ee/` 目录：

- **CE 模式**（无 `ee/`）：使用各组件自身的 Dockerfile 和 build context，构建纯 CE 镜像。admin 组件跳过构建（CE 不含管理后台）。
- **EE 模式**（有 `ee/`）：
  - backend：追加 `COPY ee/ ./ee/` 将 EE 后端模块打入镜像
  - admin：直接使用 `ee/nodeskclaw-frontend/Dockerfile` 构建（该目录本身就是完整的 EE 前端项目）
  - portal：生成临时 Dockerfile，`COPY ee/frontend/portal/ /ee/frontend/portal/` 使 Vite alias 覆盖生效

K8s 清单（`k8s/*.yaml`）CE/EE 通用，差异仅在镜像内容。
