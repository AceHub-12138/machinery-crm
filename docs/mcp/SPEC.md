# DachuanPro 统一只读 MCP v1 规格

初始基线提交：`29d92dae606112def7c17b0530940210ebb0dfe7`

身份桥接 PoC 基线提交：`dd0338f55de16e6ebf6fb4a6e7cae3ebb2a8fa43`

## 验收范围

- 一个 Streamable HTTP 地址同时暴露 CRM 与 ERP 工具，内部按 `crm_`、`erp_` 前缀分组。
- 覆盖客户及跟进、产品、合同、供应商、采购订单、库存及出入库、整机用料清单、生产工单、齐套检查、发货状态。
- 第一版只有查询。不得提供新增、修改、审批、删除或任意 SQL 工具。
- 复用现有 Next.js、Prisma、MySQL 和角色/负责范围规则，不修改业务功能、Prisma schema、migration 或业务数据结构。
- API Key 仅保存 SHA-256，只标识 FastGPT 服务，不绑定业务用户。用户身份由 CRM 登录 Session 在 Gateway 侧签发的 Ed25519 短期断言提供；MCP 每次调用实时读取用户启用状态、角色和负责范围。
- `tools/list` 要求 MCP 服务 Key和调用方 requestId，可不带用户断言；`tools/call` 要求服务 Key、短期用户断言和调用方 requestId 三项齐全。缺失 requestId 必须拒绝，不能以服务端生成值替代。
- FULL_READ_ONLY 禁止旧 API Key 绑定用户路径；服务 Key 不携带业务角色，也不获得管理员权限。
- MCP 协议调用和鉴权拒绝均写入现有 `OperationLog`；已认证调用审计失败时不得返回查询结果。
- 工具返回统一为 `{ ok, data, meta, error }`，同时提供文本内容和 `structuredContent`。
- FastGPT 4.15.1 使用固定提交的最小服务端补丁，在请求级 `AsyncLocalStorage` 中传递用户断言；兼容 Streamable HTTP 和 SSE 出站。
- 提供容器构建、环境变量模板、反向代理示例、接入说明和测试报告。

## 非目标

- 不增加数据库表或字段，不执行 migration。
- 不改变 CRM/ERP 页面、既有 API 或 Session 登录流程。
- 不在 MCP 中暴露附件 URL、任意字段选择、任意排序或任意 SQL。
- 不部署、不推送分支、不操作生产数据库。

## 身份与 FULL_READ_ONLY 准入门槛

PoC 默认只暴露 `dachuan_identity_who_am_i`。FULL_READ_ONLY 共发布 22 个工具：身份工具 1 个、CRM/ERP 只读业务工具 21 个。两用户并发隔离、五角色逐工具矩阵、伪造身份无效、无效令牌拒绝、用户停用/角色变化实时生效和具体 userId 审计全部通过后，才满足服务器测试准入；生产部署仍需 Linux 验收和部署前备份确认。
