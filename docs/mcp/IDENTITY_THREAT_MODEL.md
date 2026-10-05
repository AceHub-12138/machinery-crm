# 身份桥接 PoC 威胁模型

## 资产和信任边界

受保护资产包括 ERP 用户身份、角色与负责范围、客户/合同等业务数据、FastGPT Chat Key、MCP 服务 Key、Ed25519 私钥、用户断言、Redis JTI 状态和 `OperationLog`。浏览器、模型输入、普通 FastGPT 变量、工具参数和外部网页均不可信；Agent Gateway、固定版本 FastGPT 服务端补丁、MCP、Redis 和 MySQL 之间必须使用受控网络及 TLS。

| 威胁 | 防护 | 剩余风险/上线门禁 |
| --- | --- | --- |
| 用户或模型伪造 userId、角色、区域 | Gateway 从现有 Session 取 userId；令牌只含 sub；MCP 每次查库；`who_am_i` 参数为空且 strict | 需在隔离环境用真实角色/区域数据复验 |
| 服务 Key 被当成管理员身份 | 服务 Key 不绑定业务用户；发现方法只允许列目录，任何工具调用仍要求用户断言；旧路径默认关闭 | 必须清理生产旧配置并确认兼容开关为 false |
| 断言篡改、错签发方/受众、过期或未知 kid | Ed25519、固定 alg、kid 白名单、iss/aud/exp/nbf 校验 | 时钟漂移仅容忍 5 秒，所有实例需 NTP |
| 令牌重放 | 5～15 分钟 TTL、Redis JTI 登记/撤销、TLS、服务间受控网络 | PoC 未实现单次消费；合法窗口内被窃取仍可重放，生产需评估会话级撤销策略 |
| 多会话、多标签页或高并发串身份 | 身份仅在请求头和 FastGPT AsyncLocalStorage；每次 MCP 建立请求上下文；无用户身份全局变量；自动化覆盖 40/48 路交错请求 | 需在真实 FastGPT 流式和非流式链路压测 |
| 管理端发现因缺少用户断言失败或接受静态伪造身份 | FastGPT 删除所有静态 `X-Dachuan-*`，无聊天上下文时只生成 requestId；MCP 对 initialize/ping/tools/list 分级放行，对 tools/call 失败关闭 | 固定补丁和镜像版本，真实管理端 API 必须纳入隔离验收 |
| 用户停用或角色变更后旧令牌继续越权 | MCP 每次调用按 sub 实时查询 isActive、role、region、territories、viewScope 和工具权限 | 数据库/Redis不可用必须保持失败关闭 |
| Header 注入或直接绕过 Gateway | 浏览器不持有专用 FastGPT Chat Key；FastGPT 仅转发服务端请求头；MCP 再验签 | FastGPT Chat Key 泄露会扩大入口，必须独立、轮换并限制网络来源 |
| 密钥或业务内容进入日志 | 代码不记录请求头、断言、密钥、查询原文或参数值；拒绝原因使用固定代码 | 需审查 Nginx/FastGPT/APM 默认 header/body 日志并脱敏 |
| 审计不可用但业务结果已返回 | MCP 审计写入失败时返回 503，不交付结果 | 数据查询可能已执行但为只读；OperationLog 容量需监控 |
| Redis 故障导致绕过 JTI/限流 | Gateway 和验证器失败关闭 | Redis 高可用、持久化、访问控制和备份需在部署评审确定 |
| FastGPT 升级覆盖补丁 | 精确提交校验、独立 patch、自动 apply/rollback、固定自定义镜像标签和 revision label | 每次升级必须重新审查和运行并发测试，禁止漂移到 latest |
| Gateway 与 MCP 同进程扩大签名私钥暴露面 | PoC 仅最小闭环、私钥不进入浏览器/FastGPT/MCP 输出、容器和配置权限受限 | 正式部署前应评估拆分独立 Gateway 服务或 KMS/HSM 签名；当前为明确剩余风险 |
| 外部搜索诱导内部工具或数据外发 | 本阶段不接入搜索；后续独立 Search Policy Gateway，搜索与 MCP 分阶段执行 | 搜索脱敏、注入防护和来源策略留待下一阶段验收 |

## 审计最小化

`OperationLog` 记录具体 ERP `userId`（能可信确定时）、工具名、requestId、状态码、成功状态、耗时和固定拒绝原因。只记录工具参数键名，不记录参数值、查询原文、用户断言、API Key、Token、密码、环境变量或业务响应。无效断言不能信任其中的 sub，因此归属 `MCP_AUDIT_USER_ID`，同时保留 requestId 和拒绝原因。

## 明确不提供的能力

PoC 和第一阶段 MCP 均不提供新增、修改、审批、删除、任意 SQL、任意字段选择或自动写回。外部搜索结果不能触发业务写入；本阶段搜索工具完全未接入。
