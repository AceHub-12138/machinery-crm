# DachuanPro CRM/ERP 重要架构决策记录

本文件用于追加记录长期有效的重要架构决策。

## 记录格式

```text
日期：
决策：
背景：
影响范围：
回滚或调整方式：
```

日期：2026-07-15
决策：采购需求与采购订单分层，并使用来源分摊表统一生产工单、备货、月度计划和手工来源。
背景：采购建议生成时供应商、价格和付款方式可能尚未确定，现有采购订单又要求供应商；直接把所有缺料写成采购订单会强制错误关联并难以防止月度计划转工单重复采购。
影响范围：新增 `erp_purchase_demands` 与 `erp_purchase_order_item_sources`；同一有效来源和物料使用数据库唯一键防重，多个来源可分摊到同一采购明细，入库按分摊顺序核销。
回滚或调整方式：先回滚应用代码，再在已备份数据库上执行本次 migration 同目录的 `rollback.sql`；已有旧采购订单与旧缺料来源表不删除。

日期：2026-07-15
决策：库存变化采用事务内写入幂等齐套复检队列，不覆盖历史齐套结果。
背景：入库、出库、退料和盘点可能影响多个未完工工单；直接在每个库存事务中同步重算所有工单会放大锁时间，完全依赖页面手工复检又不可靠。
影响范围：库存事务标记工单 `kitCheckRequired` 并按工单唯一写入队列；cron 或管理员入口处理队列并新增不可变齐套快照。
回滚或调整方式：停止 cron 后回滚应用与新增表；历史 `erp_kit_check_results` 不受影响。

日期：2026-07-16
决策：整机用料清单只维护单台设备的标准物料和数量；正式缺料测算与采购需求生成统一放在生产工单，月度生产计划只冻结用料需求，不自动采购。
背景：整机用料清单中的缺料测算与生产工单重复，旧流程还会直接生成采购订单草稿并产生大量逐项弹窗，用户无法判断采购结果所在位置。
影响范围：删除整机用料清单缺料测算和旧直达采购草稿接口；生产工单齐套检查后由用户一次确认批量生成采购需求；采购需求页面统一选择供应商并转采购订单草稿。月度备件预测复用现有采购需求结构，以独立来源标识保存，不新增数据库结构。
回滚或调整方式：回滚本次应用提交即可恢复旧页面与接口；不删除历史采购订单、采购需求、来源记录或附件，也不执行数据库回滚。

日期：2026-07-17
决策：统一 MCP 作为现有 Next.js 的只读 Route Handler，以固定 Prisma 查询复用权限，并可用独立容器和域名部署。
背景：FastGPT 需要一个地址同时查询 CRM 与 ERP，但不得绕过既有角色/负责范围、开放任意 SQL或引入业务写操作。
影响范围：新增 `/api/mcp`、21 个只读工具、API Key 哈希绑定、`OperationLog` 审计和独立 Docker/Nginx 配置；不修改 Prisma schema、migration、既有业务 API 或页面。
回滚或调整方式：停止独立 MCP 容器并移除反向代理，回滚应用提交即可；数据库无需回滚，历史审计日志保留。

日期：2026-07-17
决策：统一 Agent 使用 FastGPT 服务身份 Key 与每名 ERP 用户 Ed25519 短期断言的双身份体系；FastGPT 4.15.1 通过请求级最小补丁传递断言。
背景：FastGPT 原生插件只能传固定 Token 和普通变量，不能在 MCP 调用时安全动态注入可信用户身份；共享角色 Key 或把身份写进提示词会造成越权和并发串身份风险。
影响范围：新增 CRM Agent Auth Gateway、Redis JTI/撤销/限流、`who_am_i`、严格三请求头校验和 FastGPT 固定提交补丁；MCP 每次调用实时查询数据库权限。旧 API Key 绑定用户路径生产默认关闭，PoC 默认隐藏 21 个业务工具。
回滚或调整方式：回滚 CRM/MCP 提交，反向应用 FastGPT patch 并恢复原固定镜像；不执行数据库回滚，保留既有 OperationLog。若未来 FastGPT 原生提供可信请求上下文插件，可在相同三请求头协议下替换补丁。

日期：2026-08-03
决策：DachuanPro 2.0 采用单系统、单登录、单数据库的渐进式领域化；旧 URL 与新领域 API 共同调用服务层，不能一次性重命名或拆站。
背景：当前 CRM 工作台、ERP Phase 4、桌宠 Agent assertion 和既有收藏 URL 已有生产兼容价值；大版本升级需要菜单/驾驶舱重组而非推倒重建。
影响范围：后续在 `src/modules/{crm,erp,system,agent}` 抽取服务；`/dashboard`、`/api/dashboard`、`/api/erp/**`、`/api/agent/assertion` 等入口保留兼容。MCP 只连接受控服务/Agent API，不直接连接数据库。
回滚或调整方式：每阶段独立分支和提交；新 Route 发生问题时移除新菜单/新 Route，旧 URL 和服务行为保持可用。高风险库存作废继续独立分支和追加式数据库变更。

日期：2026-08-17
决策：Lead 评分采用模型无关严格 JSON 契约，FastGPT 仅为应用 allowlist 签发独立 SERVICE 断言后调用 N3 `lead_upsert`。
背景：N8N 需要把清洗线索交给模型评分并安全写入线索池，同时必须允许未来替换 DeepSeek，且不能把模型输出、requestId 或人类身份当成写权限和幂等依据。
影响范围：FastGPT v4.15.1 补丁新增与人类路径四隔离的 SERVICE 签发；生产工作流拆为无 MCP 权限的 Score Agent 与唯一进入 SERVICE allowlist 的 Write Agent。N8N 逐条评分、整页锁定后一次批写，写重试复用相同正文和 idempotencyKey；模型只需输出 `lead-score-v1`，版本写入 `sourceModelVersion`/`extractorVersion`。MCP、数据库 schema 和写账号权限不变。
回滚或调整方式：先关闭 N8N 触发器，再回退 FastGPT 工作流/应用 allowlist 并 `git revert`；保留已写 Lead 与审计。换模型只创建新工作流版本、更新模型版本字段并复验严格契约，不修改 N3。

日期：2026-08-24
决策：Lead 自动销售路由只使用经过标准省市表验证的结构化 `profile.province/profile.city`；国内销售复用 CRM 用户 `territories` 唯一匹配，`国外` 线索按 FOREIGN_TRADE 角色唯一匹配；只在真正新建 Lead 时执行，人工分配与自动分配使用不同审计主体和 action。
背景：AI Lead 不能长期全部未指派，但也不能让 FastGPT/N8N 直接传入任意 `assignedUserId`，或按公司名、关键词和自然语言猜测地区；REPLAY、冲突和同公司合并还必须保持既有负责人不变。
影响范围：新建 Lead 的 N3 事务可在 INSERT 时写入服务端解析出的 assignedUserId；零匹配、多匹配、地域缺失或路由不可用均创建未指派 Lead，并由 LeadWriteAudit 记录 AUTO_ASSIGN/失败原因。SUPER_ADMIN 人工分配和改派写 OperationLog，SALES/FOREIGN_TRADE 仍无改派权限。写账号只增加 `users(id,role,territories,isActive)` 列级 SELECT，不获得 User 写权限或 assignedUserId UPDATE；不修改 Prisma Schema。
回滚或调整方式：代码使用 `git revert` 回退并对称回收 users 列级 SELECT；保留 Lead、LeadWriteAudit、OperationLog 和反馈历史。现有 FastGPT profile 尚未提供省市时保持未指派，后续只能通过版本化严格契约补充标准省市字段，不能在本模块加入文本猜测规则。


日期：2026-09-21
决策：展厅公开大屏的公开数据服务允许使用代码内构造的固定全公司读取身份（`COMPANY_READER`，SUPER_ADMIN/viewScope=ALL）调用 `getCrmDashboard`/`listSalesTargets`，作为权限体系的受控例外。
背景：展厅 LED 屏凭可撤销 publicId 无登录访问，需要全公司固定当月口径；任务书明确要求服务器专用入口直接调用服务层，不生成登录会话、不向浏览器暴露伪造用户。该身份是模块内常量，不进入任何响应序列化。
影响范围：仅 `src/modules/screen/public-service.ts` 内部；保护链为 publicId 格式校验（先于任何读取）、`salesScreenShare` 匹配、`salesScreen.enabled` 门、第 2 步白名单转换器。响应统一 no-store/noindex，错误不区分失效原因。Dashboard 服务为此新增可选 `now` 注入参数，默认行为不变。
回滚或调整方式：`git revert` 对应提交即可移除公开服务与该身份常量；关闭 `salesScreen.enabled` 或撤销 publicId 可立即停止公开数据输出。若未来引入正式的服务间身份机制，应以最小改动替换该常量。
