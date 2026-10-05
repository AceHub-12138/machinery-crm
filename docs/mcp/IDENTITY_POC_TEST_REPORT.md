# CRM/ERP Agent 身份桥接 PoC 测试报告

- 日期：2026-07-17
- 分支：`codex/unified-readonly-mcp`
- 本轮基线：`97d6cdd3c975e8d7fca0000553bb8197fa8997ee`
- 范围：身份桥接 PoC；不包含联网搜索和 21 个业务工具的新身份权限矩阵

## 需求覆盖

| 验证项 | 自动化证据 | 结果 |
| --- | --- | --- |
| 多会话、多标签页、高并发不串身份 | Gateway 48 路、MCP 40 路、FastGPT AsyncLocalStorage 48 路交错并发测试 | 通过 |
| 伪造 userId/角色/区域无效 | `who_am_i` 使用 strict 空参数；伪造参数返回 `INVALID_ARGUMENT`；有效 Ed25519 sub 映射到实时 DB 用户 | 通过 |
| 过期、篡改、错误 iss/aud | JWT 单测覆盖固定错误码；同时校验 alg/kid/nbf 和 300～900 秒实际寿命 | 通过 |
| 用户停用或角色变化立即生效 | 同一断言连续调用时修改模拟数据库用户；角色立即更新、停用立即 403 | 通过 |
| 请求与审计定位具体 ERP userId | 成功/停用审计断言 userId、requestId、工具、状态和固定拒绝原因 | 通过 |
| 方法分级鉴权 | initialize/ping/tools/list 只需服务 Key+requestId；tools/call 缺用户断言时 who 与业务工具均在数据访问前拒绝 | 通过 |
| 旧管理员 Key 不绕过 | strict 模式残留 userId 仍拒绝；生产环境即使显式打开兼容开关也拒绝启动 | 通过 |
| Key 轮换、JTI 撤销 | 多 kid 验证旧 Token、active kid 签发新 Token、撤销后拒绝 | 通过 |
| 浏览器/日志不泄密 | Gateway 不转发浏览器 Cookie/Authorization，响应正文无断言；审计只保存参数键名 | 通过 |
| FastGPT 管理发现与静态头隔离 | 管理端无聊天上下文时只生成 requestId；静态 `X-Dachuan-*` 全部剥离；聊天时只注入当前请求上下文值 | 通过（97 项上游定向测试） |
| 工具目录最小泄露 | 22 个工具的名称/标题/描述测试禁止数据库、SQL、内部字段和权限实现措辞；运行默认仍只发现 who | 通过 |
| Gateway CSRF 来源 | 非 CRM Origin 在读取 Session 前拒绝 | 通过 |
| FastGPT 补丁可应用/回滚 | 精确提交上执行 rollback → apply → `git diff --check` → 反向 apply check | 通过 |
| 隔离环境包 | 固定镜像/提交、MySQL/Redis/FastGPT 依赖、CRM/Gateway/MCP、Nginx、随机 env、一键启动/验收/回滚、固定 seed 安全检查 | 静态检查通过；实启待 Docker |

## 质量门禁

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 主仓库全量自动化 | `corepack pnpm test` | 20 个测试文件、113 项测试全部通过 |
| TypeScript | `corepack pnpm exec tsc --noEmit` | 通过，0 错误 |
| ESLint | `corepack pnpm lint`；新增文件定向 lint | 通过，0 错误；全仓既有 warning 未作为本轮修改范围，新增文件 0 warning |
| Next.js 生产构建 | `corepack pnpm build` | 通过；包含 `/api/agent-gateway/chat`、`/api/mcp` |
| FastGPT MCP/请求上下文 | 在 `packages/service` 执行 `corepack pnpm exec vitest run -c vitest.config.ts test/core/app/mcp.test.ts test/core/workflow/utils/context.test.ts --coverage=false` | 2 文件、97 项通过；末尾测试 HTTP server 清理出现一次非失败 `ECONNRESET`，进程退出码 0 |
| Patch 格式 | `git apply --check`、`git diff --check`、反向 `git apply -R --check` | 通过 |
| Ed25519 keygen | 生成临时文件、解析数组/kid/privateJwk、验证不输出私钥后安全删除 | 通过 |
| Prisma/migration 范围 | `git diff --name-only dd0338f -- prisma/schema.prisma prisma/migrations` | 无输出 |
| 验收脚本静态检查 | PowerShell parser、YAML parser、env 生成/Ed25519/Key hash 校验 | 通过；本机无 Bash，`bash -n` 未执行 |
| Docker 实构建/真实链路 | `docker version`、`deploy/identity-acceptance/start.ps1` | 当前 Windows 环境无 Docker，前置检查失败；没有生成镜像或真实链路 PASS |

## 未声称完成的验证

- 未启动真实 FastGPT、Redis、MySQL 的全网络链路；隔离包已经准备，但当前机器没有 Docker。`FULL_READ_ONLY` 门禁因此未通过。
- FastGPT 管理界面发现的代码路径和上游单测已通过，但仍需由隔离栈中的真实 `/api/core/app/mcpTools/getTools` 验证；验收 runner 已包含该检查。
- 未连接生产数据库，未执行 migration、seed、部署或远程推送。
- 未运行 FastGPT 全仓测试；仅运行与补丁直接相关的 MCP client 和 service context 测试。每次 FastGPT 升级都必须在其完整构建环境重新执行全仓门禁。
- Redis 实现已使用官方客户端、TTL、SHA-256 键和原子 Lua 限流，但本机无 Docker，未做真实 Redis 故障/多实例集成测试。
- PoC 自动化通过不等于允许开启 `FULL_READ_ONLY`；当前明确未准入，因此未开始 21 个业务工具适配，也不会形成第二阶段 Commit。
