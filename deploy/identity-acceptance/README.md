# 身份桥接隔离环境验收

本目录只用于真实链路隔离验收，不是生产部署模板。默认模式是 `MCP_TOOL_MODE=IDENTITY_POC`；第一阶段完整 PASS 后，可仅在该隔离环境把模式切换为 `FULL_READ_ONLY`，验证身份工具加 24 个业务工具的 25 项目录。

批次 04 另提供 `lead-e2e` Compose profile：增加只暴露 `lead_upsert` 的 `lead-mcp`、模型无关固定评分 mock 和 Lead E2E Runner。FastGPT 的 SERVICE 私钥来自 `.lead-service-private-jwk` Compose Secret；该文件与运行时 env 都被 Git 忽略，Lead MCP 只收到公钥。profile 不改变默认身份/只读验收目录。

## 固定版本与边界

| 组件 | 固定版本/标签 |
| --- | --- |
| FastGPT 源码 | `a0aec83f2ae444f5783416d17d0d9d12b7c1dc39` |
| FastGPT 自定义镜像 | `dachuan-fastgpt:v4.15.1-identity-acceptance.1` |
| CRM/Gateway/MCP | `dachuanpro-crm-erp-mcp:1.2.0-identity-acceptance.1` |
| MySQL | `mysql:8.0.44`（linux/amd64 manifest：`sha256:f7878bec832c6be5e61c39d3949651be8aa977daf875089b4560ae1434d2cb9c`） |
| Redis | `redis:7.2-alpine` |
| MongoDB | `mongo:5.0.32` |
| pgvector | `pgvector/pgvector:0.8.0-pg15` |
| FastGPT Plugin | `ghcr.io/labring/fastgpt-plugin:v1.0.0` |
| FastGPT Code Sandbox | `ghcr.io/labring/fastgpt-code-sandbox:v4.15.0` |
| AIProxy | `ghcr.io/labring/aiproxy:v0.6.5` |
| MinIO | `minio/minio:RELEASE.2025-09-07T16-13-09Z` |

MySQL、Redis、MongoDB、PostgreSQL 和 MinIO 只使用本 Compose 项目的命名卷。数据库初始化只执行仓库现有 migration；固定 seed 脚本同时检查 `IDENTITY_ACCEPTANCE_ENV=isolated` 和数据库主机名 `mysql`，不满足即拒绝。没有生产地址、生产账号或生产数据导入步骤。

## 一键启动

Windows PowerShell：

```powershell
.\deploy\identity-acceptance\start.ps1
```

Linux：

```bash
./deploy/identity-acceptance/start.sh
```

首次执行会：生成仅保存在忽略文件中的随机密钥；克隆并校验精确 FastGPT 提交；应用可回滚补丁；运行 FastGPT 定向测试；构建固定镜像；先启动隔离 MySQL/Redis；创建但不启动 migration 容器；确认 migration 与 MySQL 实际只连接内部 `identity-data` 网络且未发布宿主端口；再应用现有 migration、写入六名显式标记的验收用户并启动 CRM/Gateway/MCP、FastGPT 依赖和 Nginx。

Windows 脚本使用明确的 `docker build` 构建三个本地镜像，Compose 仅执行 `up --no-build`，从而兼容仓库所在的中文目录并避开 Compose/Bake 的 gRPC 元数据限制。FastGPT 镜像内统一固定 `pnpm 10.33.4`，Canvas 原生编译工具只存在于 builder，最终运行镜像只保留所需共享库。

本机入口：CRM `http://127.0.0.1:18080`，FastGPT `http://127.0.0.1:18081`，MCP `http://127.0.0.1:18080/api/mcp`。Nginx 日志格式不记录 Header、Cookie 或请求正文。

`/api/mcp` 及其子路径不使用 CRM 网页 Session 中间件，而由 MCP handler 自身执行服务 Key、requestId 和用户断言校验；其他 CRM/ERP API 仍保持原有登录和角色权限校验。

当前身份 PoC 不验收 FastGPT 文件上传。Compose 将对象存储外部地址保留为容器内 MinIO 地址，避免隔离服务回连宿主；若后续验收浏览器上传/下载，应另行设计只绑定回环端口的外部地址并新增专项测试，不能直接沿用到生产。

## FastGPT 一次性验收配置

1. 用 `.env.identity-acceptance` 中的 `FASTGPT_ROOT_PASSWORD` 登录隔离 FastGPT。
2. 创建 MCP 工具集，地址填 `http://nginx:8080/api/mcp`，只配置 `Authorization: Bearer <MCP_SERVICE_KEY>`。不要配置任何 `X-Dachuan-*` 头。
3. 确认管理界面能发现且只发现 `dachuan_identity_who_am_i`。
4. 创建只用于验收的 Agent，挂载该工具，并要求收到“调用 who_am_i”请求时实际调用工具。
5. 创建该 Agent 的专用 API Key，写入 `.env.identity-acceptance` 的 `AGENT_GATEWAY_FASTGPT_API_KEY`，然后只重建 CRM：

```powershell
docker compose --env-file .\deploy\identity-acceptance\.env.identity-acceptance -f .\deploy\identity-acceptance\docker-compose.yml up -d --force-recreate crm
```

这些值不得复制到提示词、普通 FastGPT 变量、浏览器 localStorage、聊天记录或工单。

## 一键验收与逐项覆盖

Windows：

```powershell
.\deploy\identity-acceptance\accept.ps1
```

Linux：

```bash
./deploy/identity-acceptance/accept.sh
```

完成默认栈启动后，可在同一隔离环境执行 Lead 端到端验收：

```powershell
.\deploy\identity-acceptance\accept-lead-e2e.ps1
```

```bash
./deploy/identity-acceptance/accept-lead-e2e.sh
```

该流程通过 FastGPT 官方 API 创建仅供 CI 的工作流和应用 Key，调用内部 DeepSeek/OpenAI Chat Completions 兼容 mock，再由 FastGPT 签发 SERVICE 断言调用 `lead_upsert`。它验证创建、同键重放、严格公司名指纹命中后合并同一 Lead、关键词累积、非法评分整次拒绝、模型/解析器版本落库和写审计。mock 只是 CI 的确定性替身，不限制生产选择 DeepSeek 或其他模型。

FULL_READ_ONLY 验收前，仅修改被 Git 忽略的隔离 `.env.identity-acceptance`，重建 CRM 和验收 Runner 镜像后执行：

```powershell
.\deploy\identity-acceptance\accept.ps1 -ExpectedToolMode FULL_READ_ONLY
```

Linux 使用 `EXPECTED_MCP_TOOL_MODE=FULL_READ_ONLY ./deploy/identity-acceptance/accept.sh`。验收完成后应把隔离环境切回 `IDENTITY_POC`；不得修改生产环境变量。

## GitHub Actions Linux 成品

`.github/workflows/full-readonly-linux-acceptance.yml` 只在当前可信身份分支相关文件变更或手动触发时运行。它在 GitHub 托管的 `ubuntu-24.04` 临时 Runner 中动态生成隔离凭据，使用 `IDENTITY_ACCEPTANCE_AUTO_PROVISION_FASTGPT_KEY=1` 自动创建 MCP 工具集、挂载 `dachuan_identity_who_am_i` 的无模型工作流 Agent，以及带 Agent ID 传输后缀的一次性团队 API Key，随后完整执行 `start.sh`、`accept.sh` 和 `rollback.sh`。该开关不改变本地默认的手工 Key 流程。

成功后上传 `dachuan-full-readonly-linux-<run-id>` Artifact，内含三项项目镜像和九项按 linux/amd64 manifest digest 锁定的外部运行时镜像的 `tar.gz`、Compose、Linux 脚本、环境模板、Linux 验收报告、外部镜像 Config Digest 和 SHA256 清单。Artifact 不包含运行时 `.env`、测试凭据、Runner 日志正文或生产配置。

下载成品用于另一台隔离 Linux 测试机时，需具备 Docker Engine、Docker Compose v2、Node.js 20+、gzip 和 `sha256sum`；不需要访问 Docker Hub、GHCR 或其他镜像仓库。先校验 Artifact 的 `SHA256SUMS`，设置 `IDENTITY_ACCEPTANCE_TOOL_MODE=FULL_READ_ONLY`、`IDENTITY_ACCEPTANCE_USE_PREBUILT_IMAGES=1` 和 `IDENTITY_ACCEPTANCE_AUTO_PROVISION_FASTGPT_KEY=1` 后运行成品内的 `start.sh`。预构建模式会在加载前核验 SHA256SUMS、RepoTags、tar 内 Config Digest 与 linux/amd64，加载后复验镜像标签和 linux/amd64，并以 `--pull never` 启动；GitHub Actions构建阶段本身不设置该开关，仍会从精确FastGPT提交和当前CRM/MCP提交真实构建，并在清理固定隔离项目卷后，从成品目录以空卷、无运行时 `.env` 的条件再完整复跑一次 `start.sh`、`accept.sh`、`rollback.sh --purge-isolated-data`。

验收 runner 逐项检查：

1. 服务身份完成 `initialize`、`ping/tools/list`；`IDENTITY_POC` 为 1 项，`FULL_READ_ONLY` 为身份工具加 24 个业务工具，共 25 项；
2. `tools/call` 缺用户断言时拒绝，不能执行 `who_am_i`；
3. 正常用户和 48 路两用户/多会话/多标签页交错调用不串身份与 requestId；
4. 篡改、过期、错误 `iss/aud/kid` 断言全部拒绝；
5. Redis JTI 撤销立即生效；
6. 同一令牌下，数据库中的角色、区域和停用状态实时生效；
7. FastGPT 4.15.1 管理端真实 `/api/core/app/mcpTools/getTools` 完成工具发现；
8. 两个真实 CRM 登录 Session 以 24 路多标签页、流式/非流式混合请求经过 Gateway → FastGPT → MCP，每个 requestId 的 OperationLog 均落到预期 ERP userId；
9. 成功和拒绝审计可定位，且审计、工具响应、全部隔离服务捕获日志均不含已配置密钥或 JWT 形态的动态断言。

任一检查失败时脚本返回非零，不生成通过结论。证据保存在被 Git 忽略的 `acceptance-output/`，提交前不得把这些日志加入 Git。

## 回滚

默认回滚仅停止隔离栈并保留命名卷：

```powershell
.\deploy\identity-acceptance\rollback.ps1
```

只有明确确认后才删除本 Compose 项目的隔离卷：

```powershell
.\deploy\identity-acceptance\rollback.ps1 -PurgeIsolatedData
```

Linux 分别使用 `rollback.sh` 和 `rollback.sh --purge-isolated-data`。隔离栈会应用仓库中的 additive Prisma migration；普通停止保留隔离卷，明确 purge 才删除本 Compose 项目的隔离数据。本脚本不会连接或修改生产部署。

## 第二阶段准入记录

只有同时具备以下证据才能把 `MCP_TOOL_MODE` 改为 `FULL_READ_ONLY` 并开始独立第二个 Commit：镜像 revision/测试标签与本地 `sha256` image ID、Compose 全服务健康、上述九组检查全部 PASS、OperationLog 抽检、日志敏感信息扫描为零、明确记录验收时间和操作者。FastGPT 定向测试不可跳过；自动化单测通过或直接 MCP 调用通过均不能替代真实 CRM → Gateway → FastGPT → MCP 链路。
