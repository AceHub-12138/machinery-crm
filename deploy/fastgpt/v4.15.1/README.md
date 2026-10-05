# FastGPT v4.15.1 可信 MCP 身份补丁

适用且仅适用于 FastGPT 源码提交：

```text
a0aec83f2ae444f5783416d17d0d9d12b7c1dc39
```

该提交对应用户指定的 FastGPT 4.15.1 基线。v2 补丁保留原人类断言路径，并为 allowlist 中的 Lead Agent 增加短期 SERVICE 断言签发；两类断言都不写入变量或模型输入，只在服务端请求上下文和 MCP 出站调用之间传递。

## Windows 应用与回滚

```powershell
.\apply.ps1 -FastGptSource C:\src\FastGPT
```

```powershell
.\rollback.ps1 -FastGptSource C:\src\FastGPT
```

## Linux 应用与回滚

```bash
./apply.sh /opt/src/FastGPT
```

```bash
./rollback.sh /opt/src/FastGPT
```

脚本先执行 `git apply --check`；应用脚本还会校验 HEAD 精确提交。任何预检失败都应停止，不得强制套用。

## 测试与固定镜像

应用后在 FastGPT 源码目录执行：

```bash
cd packages/service
```

```bash
corepack pnpm exec vitest run -c vitest.config.ts test/core/app/mcp.test.ts test/core/app/dachuanLeadServiceAssertion.test.ts test/core/workflow/utils/context.test.ts --coverage=false
```

随后按 FastGPT 4.15.1 原构建流程生成自定义镜像，并固定标签：

```text
dachuan-fastgpt:v4.15.1-identity-acceptance.1
```

Compose/Kubernetes 必须引用这个不可变标签或进一步固定 digest，不得使用 `latest`。部署前保存原 FastGPT 镜像标签/digest；回滚时恢复原镜像并重启 FastGPT，不需要修改 CRM/ERP 数据库。

## 变更范围

- Chat Completions 入口读取两个可信头；
- 工作流 dispatch 将身份放入已有请求级上下文；
- MCP Streamable HTTP/SSE 出站先移除静态 `X-Dachuan-*` 头；聊天时追加两个请求级可信头，管理端发现时只生成 requestId；
- 管理端静态伪造头测试和 48 路并发上下文测试验证发现安全与身份隔离。
- 仅对 `LEAD_SERVICE_ASSERTION_APP_IDS` 中的应用签发 `principalType=SERVICE`、`scope=["lead:create"]` 的短期断言；SERVICE audience、Ed25519 密钥、Redis 前缀和限流均与人类路径隔离。
- SERVICE 私钥只能通过 FastGPT 受限 Secret/文件挂载提供；MCP 只持公钥，N8N 和工作流输入不得持有私钥。

MCP 固定的 `Authorization` 服务 Key仍由 FastGPT MCP Server 配置提供。人类工作流发送用户断言，allowlist Lead 工作流发送 SERVICE 断言；两者互斥，requestId 始终只用于追踪。

Lead 生产链路拆为 `workflows/lead-score-agent-v1.json` 与 `workflows/lead-write-agent-v1.json`。评分应用采用模型无关契约且没有 MCP 权限；写应用整页校验后一次调用 `lead_upsert`，并且是唯一加入 SERVICE 应用 allowlist 的 Lead 应用。首发可以绑定 DeepSeek，也可切换其他支持严格 JSON 的模型；更换时只升级评分应用、更新 `sourceModelVersion` 并重新验收。
