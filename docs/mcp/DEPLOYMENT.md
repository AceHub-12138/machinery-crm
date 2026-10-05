# MCP Docker 部署与回滚

该方案启动复用现有 MySQL 的独立 Next.js MCP/Gateway 实例和 Redis，并使用固定版本的 FastGPT 4.15.1 身份补丁。不执行 Prisma migration，不覆盖主应用或 uploads。本文仅是上线预案；本次 PoC 未部署、未连接生产数据库。生产环境为 Linux/宝塔时，所有命令均应逐条执行并检查结果。

## 0. 上线前确认与备份

先确认现有 CRM、PM2、Nginx、环境文件和上传目录正常：

```bash
curl -fSs https://现有CRM域名/login -o /dev/null
```

```bash
pm2 list
```

```bash
sudo nginx -t
```

```bash
test -f /opt/machinery-crm-v108-release/.env
```

```bash
test -d /opt/machinery-crm-uploads
```

备份现有项目、数据库和准备修改的 Nginx 配置。`mysqldump` 应使用服务器已有的受限凭据文件或交互式密码，不要把密码写进命令历史：

```bash
sudo tar -C /opt -czf /opt/machinery-crm-v108-release-pre-mcp-20260717.tar.gz machinery-crm-v108-release
```

```bash
mysqldump --single-transaction --routines --triggers machinery_crm > /opt/machinery_crm-pre-mcp-20260717.sql
```

```bash
sudo cp /etc/nginx/conf.d/mcp.conf /etc/nginx/conf.d/mcp.conf.pre-mcp-20260717
```

若 `mcp.conf` 尚不存在，记录“首次新增”，跳过最后一条，并备份实际将修改的 CRM server 配置。成功标准是项目、数据库和所有原有待修改配置的备份均存在且非空，`nginx -t` 仍通过；任一备份失败立即停止。

## 1. 在构建机生成镜像

低配置生产服务器不现场执行 `pnpm build` 或 `docker compose build`。在有 Docker Engine 的 Linux CI/构建机执行：

```bash
docker build -f Dockerfile.mcp -t dachuanpro-crm-erp-mcp:1.1.0-identity-poc .
```

```bash
docker save dachuanpro-crm-erp-mcp:1.1.0-identity-poc -o dachuanpro-crm-erp-mcp-1.1.0-identity-poc.tar
```

确认镜像构建成功且 tar 非空，再把源码中的 `docker-compose.mcp.yml`、`.env.mcp.example`、`deploy/nginx/mcp.conf.example`、`deploy/nginx/agent-gateway.conf.example` 和镜像 tar 传到服务器专用目录。不要把 `.env.mcp` 打入镜像或传到不可信平台。

仍在可信构建机的源码目录生成 MCP 服务 Key；把 `KEY_HASH` 交给服务器环境配置，明文 `API_KEY` 只写入 FastGPT MCP Server 的固定 Authorization 头：

```bash
corepack pnpm mcp:keygen
```

在受限目录生成 Ed25519 密钥文件。脚本不会覆盖文件或打印私钥：

```bash
corepack pnpm agent:keygen -- /secure/dachuan-agent-auth-keys.json dachuan-agent-2026-07-a
```

FastGPT 必须从精确提交 `a0aec83f2ae444f5783416d17d0d9d12b7c1dc39` 构建。按 `deploy/fastgpt/v4.15.1/README.md` 应用补丁、运行并发测试，再生成并固定为 `dachuan-fastgpt:v4.15.1-identity-poc.1`；不得使用 `latest`。

## 2. 在服务器配置并启动

进入专用部署目录，复制模板并填写真实值：

```bash
cp .env.mcp.example .env.mcp
```

先收紧配置权限：

```bash
chmod 600 .env.mcp
```

把构建机生成的 `KEY_HASH` 写入 `.env.mcp`，明文只配置到 FastGPT。`MCP_API_KEYS_JSON` 不填写 `userId`，并确认 `MCP_LEGACY_USER_BOUND_AUTH=false`、`MCP_TOOL_MODE=IDENTITY_POC`。`AUTH_SECRET` 必须复制现有 CRM 的同一值，不能另生成，否则 Gateway 无法可信校验登录 Session。把 Ed25519 密钥和专用 FastGPT Chat Key 仅写入此受限文件，生产编排平台支持 Secret 时应改用其 Secret 注入；不要提交文件或复制到工单/聊天。确认 `MCP_AUDIT_USER_ID` 是现有用户 ID。数据库账号不需要 DDL 权限，但必须能读取业务数据并写入现有 `OperationLog`。

若部署的是仅开放客户、库存两项业务工具的 `FULL_READ_ONLY` Canary，启动或重建容器前必须运行不泄露配置值的预检：

```bash
node scripts/validate-mcp-canary-runtime-env.mjs /实际路径/runtime.env
```

成功标准：只输出以下摘要，不输出数据库 URL、账号、密码、API Key 或 JWT：

```text
MCP_CANARY_RUNTIME_CONFIG=PASS mode=FULL_READ_ONLY tools=2 roles=1 databaseUsersSeparated=true
```

预检会确认客户/库存两工具白名单、仅 `SUPER_ADMIN`、查询与审计数据库账号不同且指向同一数据库目标。出现 `MCP_CANARY_RUNTIME_CONFIG=FAIL` 时立即停止，不重建容器。该预检只检查配置结构，不替代数据库权限核验和真实业务验收。

加载已构建镜像并启动只监听本机 3010 的服务：

```bash
docker load -i dachuanpro-crm-erp-mcp-1.1.0-identity-poc.tar
```

```bash
docker compose -f docker-compose.mcp.yml up -d --no-build
```

```bash
docker compose -f docker-compose.mcp.yml ps
```

```bash
curl -fSs http://127.0.0.1:3010/api/mcp/health
```

成功标准：容器状态为 healthy，健康接口返回 `status=ok`。容器退出、unhealthy、数据库连接错误或审计写入错误都视为失败，先看日志，不继续配置公网入口：

```bash
docker compose -f docker-compose.mcp.yml logs --tail 100 dachuanpro-mcp
```

## 3. 配置 Nginx 与 FastGPT

把 `deploy/nginx/mcp.conf.example` 按真实域名和证书路径复制到 Nginx 配置目录，并把 `agent-gateway.conf.example` 的 location 合并到现有 CRM HTTPS server 块。Gateway 必须保持 CRM 同源，且 `AGENT_GATEWAY_ALLOWED_ORIGINS` 只允许真实 CRM Origin。加载前必须检查语法：

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

```bash
curl -fSs https://mcp.dachuan.pro/api/mcp/health
```

在 FastGPT 填写 `https://mcp.dachuan.pro/api/mcp` 和固定 `Authorization: Bearer <MCP_SERVICE_KEY>`，不要静态填写用户断言。CRM 页面只调用 `/api/agent-gateway/chat`，由 Gateway 使用专用 FastGPT Chat Key。用两名隔离测试用户并发调用 `dachuan_identity_who_am_i`，核对返回与 `OperationLog` 的具体 userId/requestId，再检查停用和角色变更即时生效。PoC 未通过前不得开启 `FULL_READ_ONLY`。最后重新检查现有 CRM 登录、`pm2 list`、uploads 和 Nginx，确认主系统未受影响。

## 4. 配置轮换

MCP 服务 Key 先并存新旧 hash、切换 FastGPT、再删除旧项。Ed25519 密钥先并存旧公钥和新密钥对，切换 active kid，等待最长 15 分钟，再删除旧私钥；确认无旧 kid 请求后再删除旧公钥。不要在日志或工单中粘贴明文 Key、私钥或用户断言。

## 5. 回滚

本功能没有 schema/migration 变更，数据库无需执行回滚 SQL，历史 `OperationLog` 应保留。部署前先备份实际 FastGPT Compose 文件和现有 CRM Nginx server 文件：

```bash
cp /实际路径/docker-compose.yml /实际备份路径/docker-compose.yml.pre-identity-poc
```

```bash
sudo cp /实际路径/crm.conf /实际备份路径/crm.conf.pre-identity-poc
```

回滚时先恢复补丁前固定 FastGPT Compose 并只重建 FastGPT 服务（服务名必须在部署前通过 `docker compose config --services` 确认）：

```bash
cp /实际备份路径/docker-compose.yml.pre-identity-poc /实际路径/docker-compose.yml
```

```bash
docker compose -f /实际路径/docker-compose.yml up -d --no-build fastgpt
```

然后恢复包含 Gateway location 之前的 CRM Nginx 配置：

```bash
sudo cp /实际备份路径/crm.conf.pre-identity-poc /实际路径/crm.conf
```

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

最后撤回独立 MCP 域名并停止 MCP/Redis 容器。若部署前已有 `mcp.conf`，执行恢复：

```bash
sudo cp /etc/nginx/conf.d/mcp.conf.pre-mcp-20260717 /etc/nginx/conf.d/mcp.conf
```

若这是首次新增 `mcp.conf`，不得执行上一条；把新增配置移到已确认存在的备份目录，以便恢复：

```bash
sudo mv /etc/nginx/conf.d/mcp.conf /opt/crm-backups/mcp.conf.rolled-back-20260717
```

两种情况只执行其中一种。Redis volume 可暂时保留供故障复盘，不要在未确认目标时删除。随后验证并停止容器：

```bash
sudo nginx -t
```

```bash
sudo systemctl reload nginx
```

```bash
docker compose -f docker-compose.mcp.yml down
```

若需回到上一 MCP 镜像，修改 Compose 的 `image` 标签后执行：

```bash
docker compose -f docker-compose.mcp.yml up -d --no-build
```

回滚成功标准：MCP 公网入口已撤下或恢复上一版本，现有 CRM 登录正常、PM2 online、Nginx 检查通过、uploads 仍在。禁止执行 `prisma migrate reset`、`db:reset`、`DROP DATABASE`、`TRUNCATE`，也禁止删除主项目目录、上传目录或数据库审计记录。
