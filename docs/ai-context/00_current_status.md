# DachuanPro CRM/ERP 当前开发状态

- 当前系统为 DachuanPro CRM/ERP 平台。
- 已进入 ERP 二期开发。
- 当前开发必须保护已有 CRM 功能、权限和正式数据。
- 每次重要补丁完成后，需要更新本文件。

## 2026-09-03｜小川 Agent 第 1 期：平台内引擎与基础设施（本地开发完成、未推送、未部署；全屏页 UI 待新需求定稿后重做）

- 分支 `codex/xiaochuan-agent-phase1` 基于本地 `main` 的 `607c0a58`（全局润色批次 C 合入后）。架构路线：平台内自建 Agent 引擎（用户 2026-09-02 拍板），大脑直连硅基流动 Kimi-K2.6（OpenAI 兼容），工具复用 MCP 25 工具的 Prisma 实现，不走 FastGPT。
- 未新增任何 npm 依赖；服务器不多跑任何进程，全部在现有 Next.js/PM2 内。
- 数据库：纯新增 `agent_conversations`、`agent_messages` 两张表（migration `20260903090000_add_xiaochuan_agent_conversations`，含 `rollback.sql`，只涉及 AI 对话记录）；User 模型仅追加一条反向关系。
- 引擎链路：`src/lib/agent/config.ts`（三档思考 小川快跑/陷入沉思/牛来！ = max_tokens+风格指令，env 可覆盖）、`llm-client.ts`（/chat/completions 流式 SSE 解析，工具调用增量累积，用量统计，上游错误脱敏）、`toolbox.ts`（白名单=MCP 24 个业务只读工具，zod→JSON Schema 下发，按角色过滤可见工具）、`executor.ts`（每次执行：白名单→角色校验→与 MCP 同一 Zod schema 严格解析→同一 dataSource.execute（数据范围下推）→writeAudit 审计，审计失败不交付结果）、`engine.ts`（循环默认≤6 轮、单请求 30s/总体 90s 超时、单条工具结果 12k 截断、白名单外工单回执拒绝、超限兜底话术）、`rate-limit.ts`（每用户每分钟默认 10 问）。
- 系统提示词内置：小川人设、当前用户与数据范围、数字必须来自工具返回、不展示内部字段、内容红线（拒绝违法涉政）。
- 接口：`POST /api/agent/chat`（登录态 SSE：meta/delta/tool/done/error 事件，会话归属校验，历史≤20 条，用户消息与助手回答落库含 token 用量）、`GET /api/agent/conversations`、`GET|DELETE /api/agent/conversations/[id]`（仅本人）。中间件：WAREHOUSE/PURCHASE 岗位硬隔离放行 `/xiaochuan` 与 `/api/agent/`（对话全员可用是业务拍板；数据工具内部仍按角色/区域校验）。
- 导航与入口：撤下 FloatingPet 悬浮桌宠挂载（组件保留可恢复）；`sidebar.tsx` 与 `floating-sidebar.tsx` 同步新增"小川助手"入口（图标 Bot，全员可见，含采购/仓库过滤放行）；`app-shell.test.ts` 导航契约 7→8 同步更新。
- 正式 UI（按用户 2026-09-03 五项拍板实施）：`/xiaochuan` 空状态为深色 hero——标题 "What Can I Help You?"、Spotlight 鼠标追光（原生 CSS 实现，未引入 framer-motion）、Spline 3D 演示机器人占位（用户拍板 ①b；`@splinetool/runtime` 钉在 1.9.28 规避 Turbopack draco 资源构建失败，待小川专属场景后改 `spline-scene.tsx` 的 SPLINE_SCENE_URL 一行切换）、输入框内置附件回形针占位（点击提示"图纸分析即将开通"）与思考程度胶囊（仅展示 小川快跑/陷入沉思/牛来！，不露模型名）。对话视图：左侧历史 + 消息流；小川消息带表情头像与操作条（复制/重新回答/点赞/点踩，按拍板不含分享；赞踩暂为界面状态，后续接反馈接口）；用户消息带平台头像（复用 GET /api/upload/avatar 与 UserAvatar 组件）；页面亮暗主题跟随平台既有主题切换（dark: 变体）。快捷提问保留三条业务问题并按深色主题重做样式。
- 新增 npm 依赖：@splinetool/react-spline 4.1.0、@splinetool/runtime 1.9.28（钉版）；未新增 framer-motion。
- 新增环境变量：`XIAOCHUAN_LLM_API_KEY`（必填）等，见 `.env.xiaochuan.example`；不改动任何既有环境变量，不动 AUTH_SECRET。
- 自动验证：`prisma validate` 通过；`tsc --noEmit` 通过；全量测试 109 文件 777/777 通过（新增 5 个测试文件 58 项）；ESLint 0 error；`next build` 通过且 `/xiaochuan` 路由产出；敏感信息扫描通过。
- 已知环境事项：本机 `prisma generate` 对 query_engine DLL 换名报 EPERM（被运行中的 dev 服务占用），TS 类型已成功更新且引擎版本未变，不影响构建；本地验证前需重启 dev 服务以加载新表模型。migration 尚未在任何数据库执行。

## 2026-09-03｜小川第 1 期验收修复（本地完成、未部署）：20015 修复 / 独立全屏站 / 跳转按钮 / GSAP 过渡 / 报错持久化

- 分支 `codex/xiaochuan-agent-phase1` 续作（基线 5da000ec 之后），来源：用户首轮验收反馈 5 项。
- **20015 报错修复（用户实测触发）**：硅基流动 Pro/moonshotai/Kimi-K2.6 在"思考开启 + 回填含工具调用的历史消息"时会不稳定报 `20015 reasoning_content is missing`；实测给 assistant 消息补 `reasoning_content:""` 反而必报。修复：引擎工具调用后的续轮（iteration≥2）统一 `enable_thinking:false`（仅第 1 轮按档位思考）——拿到工具结果后的合成回答无需再思考，更快更省；`streamXiaochuanChat` 签名改为接收 tierProfile（档位参数按轮次计算）。
- **独立全屏站点**：`/xiaochuan` 移出 `(app)` 路由组（脱离平台侧边栏/顶栏 AppShell），新增 `src/app/xiaochuan/layout.tsx`（SessionProvider）+ page `force-dynamic`（useSession 依赖登录态，静态预渲染会崩）；组件改为 `h-dvh` 全屏 + 自带轻量顶部栏（历史抽屉开关/小川表情头像/ThemeControl 亮暗切换/返回平台/用户头像）。生产将 ai.dachuan.pro 反代到同一应用即可整站呈现。
- **跳转按钮**：双侧边栏"小川助手"条目加 `external: true`，渲染为 `target="_blank"` 新窗口打开；地址走 `NEXT_PUBLIC_XIAOCHUAN_URL`（默认 `/xiaochuan`，生产配 `https://ai.dachuan.pro`），新增 `src/lib/agent/site-url.ts`（含 NEXT_PUBLIC_PLATFORM_URL 返回平台地址）。
- **GSAP 过渡**：hero ↔ 对话视图切换用 gsap.fromTo（淡入+上移+微缩放，0.45s power3.out），`useReducedMotion` 时跳过；未新增依赖（gsap 平台已有）。
- **界面减负（用户拍板）**：去掉 hero 右上"3D 形象为演示占位"徽标与 hero 移动端菜单按钮（顶部栏已含）；去掉 hero 输入框下"小川只基于平台权限内数据回答"提示行；hero 输入占位文案改为"Enter 发送 / Shift+Enter 换行"；输入行控件垂直居中（原偏下）。
- **报错持久化**：`agent_messages` 新增可空 `error` 列（migration `20260903110000_add_agent_message_error_flag` + rollback，已应用本地库）；chat 路由出错时也落库 assistant 行（error=true），重新进入历史对话报错信息不再丢失；前端历史回放映射 error 状态（红样式）。
- **二轮细节（同日，提交 c26677cb）**：①用户头像与气泡同一行（去下挂名字标签）；②整体全屏铺满（去外层留白与对话区卡片边框）；③对话记录侧栏可伸缩——顶部栏 PanelLeft 开关，桌面宽度过渡收起并 localStorage 记忆偏好（dachuan.xiaochuan.sidebar），移动端保持抽屉式。
- **三轮主题统一（同日）**：实测确认 Spline 演示场景为透明底（白底测试页+黑底对照截图验证），机器人可直接上浅色主题；hero 亮暗双主题（浅色=暖白橙调渐变+深色标题渐变，深色=黑）、顶部栏 hero 态悬浮透明融入/对话态跟随主题、输入框与快捷提问胶囊双主题化、Spotlight 光斑橙色双主题可见；hero 内容垂直居中+左距加大（p-8/md:p-16/lg:p-24）+ max-w-xl 收窄；问候语改为"你好，我是小川 —— DachuanPro 的专属 AI 智能体，关于平台的问题问我就行"（用户拍板）。
- 自动验证：tsc 0 error、eslint 0 error（14 warning 均为既有基线风格类）、全量 109 文件 779/779、`next build` 通过（/xiaochuan 为 ƒ 动态路由）。新增依赖：无（framer-motion 未引入，Spotlight 用原生 CSS）。

## 2026-09-03｜全局润色批次 C（本地开发完成、未推送、未部署；Codex 开工中断后由 ZCode 接手完成）

- 分支 `feat/motion-global-polish` 基于本地 `main` 的 `87a0199890b9de435b7db944a7923107c5129001`；复用既有动效基础设施与 iOS 弹簧参数，未修改全局手感配置。
- 弹窗：共享 `Dialog`/`ConfirmDialog` 增加遮罩淡入 + 面板弹簧进场（scale 0.96→1、y 10→0、0.3 秒）；按降级方案仅做进场，`open=false` 立即卸载与 Esc/遮罩/取消等关闭时序完全不变；reduced-motion 直接显示。
- 侧边栏：仅桌面 XL 折叠路径编排——折叠时文字先淡出（0.15s）再收窄宽度（既有 CSS 200ms），展开时先变宽、transitionend 后再淡入文字；快速连点收敛到最新状态；localStorage 键、菜单高亮、权限过滤、移动抽屉全部不变。
- 按钮：全局 CSS 按压反馈（独立 `scale` 属性 0.97、150ms、cubic-bezier(0.22,1,0.36,1)），仅 `prefers-reduced-motion: no-preference` 下生效，排除 disabled 与 aria-busy。
- hydration 修复：根布局两段既有脚本（主题初始化内联脚本、UUID polyfill）移入显式 `<head>`，内容/ID/策略/安全与 PWA 逻辑未动；修复前全站报 `<script> cannot be a child of <html>` 与脚本顺序 hydration 错误。
- 客户生命周期条：新增 `src/components/customers/customer-lifecycle-bar.tsx`（纯只读展示），五节点 新线索→已联系→已报价→谈判中→已成交，进度线 scaleX 弹簧展开、节点错落点亮、当前节点一次性强调；LOST/INACTIVE 以末端灰色标记显示不参与推进；同会话同状态刷新不重播，状态真实变化时从旧阶段推进；SSR 输出全部阶段文字与最终进度；客户详情页头下方接入并移除页内重复状态标签表。
- 新增契约：`src/lib/ui/motion-global-polish.test.tsx`（4 项）、`src/components/customers/customer-lifecycle-bar.test.tsx`（3 项）。
- 自动验证：`tsc --noEmit` 通过；全量测试 103 文件 739/739 通过；ESLint 0 error。
- 浏览器实测（ZCode 经本地 dev 服务）：/login、/dashboard/crm、/customers、客户详情、/leads、生产订单 LOCAL-PO-001 全部零 console/hydration 报错（修复前全站报错）；侧栏折叠/展开 264↔76px 完整闭环且状态持久化；全局搜索弹窗弹簧进场 + Esc 关闭正常；齐套检查"检查中…"→结果回放→按钮恢复正常；生命周期条在客户详情渲染、进度线推进到位。

## 2026-09-03｜ERP 齐套检查与工作台动效批次 B（本地开发完成、未推送、未部署）

- 分支 `feat/motion-erp-kit-check` 基于本地 `main` 的 `474774982eba2e8c7f6a370b6f66f42907c8f6e8`；复用既有 `MotionPage`、`AnimatedNumber`、`StaggerContainer`、`useReducedMotion` 和全局 iOS 弹簧参数，没有修改动效基础设施或全局手感。
- 生产订单详情页在手工执行齐套检查时显示禁用的“检查中…”状态；新结果不超过 50 行时只用 transform/opacity 逐行回放，单行 0.3 秒、行间隔不超过 0.08 秒并动态压缩到总计 1.5 秒内。初始已有记录只随页面整体进入，reduced-motion 和超过 50 行时直接显示。
- 缺料红字、齐套计算、API、权限和一次性返回数据流保持不变；生成采购需求成功后复用受控 run 计数器与 `data-assignment-highlight`，提供 600ms 淡橙色渐隐反馈。WAREHOUSE、PURCHASE 与 SUPER_ADMIN 原有条件分支保留。
- 齐套检查结果汇总页只增加一个页面级 `MotionPage`，表格行没有动画；ERP 工作台四个数值卡与管理员驾驶舱三个数值卡开启数字滚动，并通过既有 `StaggerContainer` 错落进入，刷新不重播容器进场。
- 本地 TypeScript、动效契约 2 文件 12 项、相关 ERP 4 文件 32 项及全量 101 文件 730 项测试通过；修改文件 ESLint 为 0 error（44 个既有 warning），`git diff --check` 通过。
- 未启动或重启 dev 服务。浏览器访问 `http://localhost:3000/login` 返回连接被拒绝，端口检查确认 3000 无监听，因此登录后视觉、控制台 hydration 和真实按钮交互验收未完成；上述浏览器效果仅为基于实现与契约的预期，不能冒充运行时实测。
- 本批没有修改 API、Prisma Schema/migration、权限、正式数据、上传文件、服务器配置或其他 ERP 页面；没有连接正式数据库、push、CI 或部署。

## 2026-09-02｜GSAP 动效基础设施与 CRM 工作台试点（本地开发完成、未推送、未部署）

- 分支 `feat/motion-foundation-dashboard` 基于本地 `main` 的 `164f49033807ec34c8c39f05d387ff68be9b7c98`；只新增 GSAP 动效基础设施并接入 CRM 工作台，没有扩展到 ERP 工作台、管理员驾驶舱或其他业务页面。
- 新增统一时长/缓动、`MotionPage`、`AnimatedNumber`、`StaggerContainer` 和 `useReducedMotion`；所有 GSAP 生命周期由 `@gsap/react` 的 `useGSAP()` 管理，reduced-motion 时直接显示，只操作透明度和 transform。数字 SSR 与客户端首帧均输出最终值，挂载后从 0 滚动，后续从旧值滚动到新值。
- `MetricCard` 以默认关闭的可选参数提供数字动画；只有 CRM Dashboard 显式启用。标题、KPI 和其余业务区按约 0.95 秒完成进入；地图组件内部未修改，成功状态仅外层淡入，地图错误态、页面骨架/错误态和 `SalesTargetCard` 内部骨架/错误态不参与编排。
- 新增 6 项动效契约测试；本地 TypeScript、Dashboard 定向 15 项、全量 99 文件 719 项测试、ESLint（0 error；全仓 580 个既有 warning）、Next.js 118 个静态页面生产构建、git diff check 以及 Standards/Spec 双轴复审均通过。
- 本地 `pnpm dev` 正常启动，但浏览器访问 Dashboard 被当前认证配置重定向到登录页，并记录 JWT session secret 不匹配；未输入账号、未改认证配置，因此工作台动画、浏览器 console、ERP 视觉对照和系统级 reduced-motion 人工验收未完成，不能用自动验证替代该项。
- 没有修改 API、Prisma Schema/migration、权限、登录、上传、地图业务逻辑或正式数据；没有连接数据库、push、CI、部署或服务器操作。

## 2026-08-26｜AI Lead 长 URL、地区自动分配与写入结果契约补强（已开发、未迁移、未部署）

- 分支 `codex/lead-contact-enrichment-v1` 基于 `5396b72c6ffec4d7d21a8dd609f1e5e493a29874` 继续施工；`sourceUrl` 契约和 Prisma 列扩到 `VARCHAR(2048)`，合法 URL 原样进入 canonical hash，2049、非法协议/格式或会被 trim 改写的 URL 明确拒绝；联系方式 workflow 的 1000 字符静默截断已移除。
- Lead 评分契约允许可选标准 `profile.province/city`；MCP 写入口与自动路由共用 `PROVINCE_CITY_MAP`，简称、缺 province 的 city、跨省 city 都不会进入合法路由。后端仍不根据 companyName 猜地区。
- `lead_write_audits` 新增独立 nullable `routingOutcome`，长期区分 `ASSIGNED`、`REGION_UNRESOLVED`、`NO_MATCHING_ASSIGNEE`、`MULTIPLE_MATCHING_ASSIGNEES`、`ROUTING_UNAVAILABLE`；既有 `outcome=CREATED/REPLAY/CONFLICT` 语义不变。
- `lead_upsert` 保留 `replay` 并新增 `writeDisposition=CREATED|MERGED|REPLAY`；只有新建返回本次 routing outcome，merge/replay 不重新路由并返回 `null`。
- v1/v1.1 生成 workflow 在主写入和三条派生写入后增加 3013 业务响应校验：必须 `result.isError !== true`、`structuredContent.ok === true` 且首项有字符串 id；HTTP 200 或存在 result 不再被当成业务成功。运行中的 N8N/FastGPT 未被修改。
- 后续生产只读证据确认 MySQL global/session 均为 `SYSTEM=UTC+8`，两表 DDL 虽相同，但 Prisma `transaction.lead.create()` 的 Lead 时间按 UTC 语义落入 DATETIME，而 `lead_write_audits` raw INSERT 遗漏 `createdAt`，触发 MySQL 本地 `CURRENT_TIMESTAMP(3)`，造成固定 `28800` 秒差。运行时统一 audit writer 及隔离验收权限探针现显式写 `UTC_TIMESTAMP(3)`；CREATE/MERGED/REPLAY/CONFLICT/routing audit 都记录各自事件发生时的 UTC，不复制原 Lead 时间。未修改历史 DDL、历史数据或 MySQL/服务器时区。
- 新增 migration `20260826150000_extend_lead_source_url_and_routing_outcome`，只扩宽列、新增 nullable routing enum 列和索引；未连接数据库、未执行 migration、未部署、未操作 N8N/FastGPT。
- 本地 Prisma validate/generate、TypeScript、全量 94 文件 685 项测试、ESLint（0 error、532 个既有 warning）、Next.js 110 个静态页面生产构建、workflow 生成一致性、敏感信息扫描和 git diff check 通过；UTC 时间补丁定向 3 文件 53 项通过，Standards/Spec 双轴复审均为 0 finding。

## 2026-08-24｜Lead 联系方式反查 v1.1 关联潜客小版本（已开发、未部署）

- 在 `codex/lead-contact-enrichment-v1` 上新增独立、默认停用的 `baidu-lead-contact-enrichment-v1.1.json`；N4 与 v1 归档保持不变。本版本把 Verifier 结果分为 `DIRECT_CONTACT`、`RELATED_OPPORTUNITY`、`REJECT`。
- DIRECT_CONTACT 的摘要必须且只能包含 1 条完整受控联系方式句；该句可按任意顺序包含一个或多个“类型匹配的联系标签 + 已提取候选值”，phone 只接受电话/手机标签，email 只接受邮箱/email 标签，因此合法二者可同时回填而标签和值互换会拒绝。RELATED_OPPORTUNITY 的摘要必须且只能包含 3 条完整受控事实句：关系、机会、联系方式。任何额外停用、纠正或第三方归属句都会整条拒绝；机会句尾也只允许受控机床、设备、生产线等业务词汇，不允许任意尾部文本。逗号仍不作为安全句界，摘要只要包含中英文问号也一律拒绝。
- 关联企业必须重新调用现有 Lead Agent 独立评分，模型不能覆盖 Verifier 锁定的企业名和联系方式；只有 `aiScore >= 80` 且联系方式有效才走独立 Lead MCP 支路。派生支路复用现有 canonical hash、v2 幂等、dedup、REPLAY/CONFLICT 和自动区域分配，不创建或修改 Customer。
- 派生写入或评分淘汰后恢复原目标的剩余 contactSearchRound；派生 Lead 不再触发联系方式搜索。百度额外搜索仍物理最多 3 次，每轮最多处理一个关联机会，不递归扩散。
- 本小版本只新增版本化 N8N/FastGPT 契约、生成器和测试；没有扩大 SERVICE 权限，没有修改 Prisma Schema/migration、共享 lead_upsert、正式数据或运行中的 N8N/FastGPT。
- v1.1 三分类与派生写入 3 文件 47 项、N3/N4 7 文件 62 项、N5 assignment 4 文件 49 项、全量 92 文件 637 项通过；Prisma validate/generate、TypeScript、ESLint（0 error、532 个既有 warning）、Next.js 110 个静态页面生产构建和 git diff check 通过。

## 2026-08-24｜高价值 Lead 联系方式反查 v1（已开发、未部署）

- 分支 `codex/lead-contact-enrichment-v1` 固定基于 N5 FINAL POLISH SHA `8e1ebd574fb1b6d0ea3e606b2f90f1835f61a6a1`；新增独立、默认停用的 `n8n/workflows/baidu-lead-contact-enrichment-v1.json`，没有覆盖 `baidu-lead-e2e-n4-pass.json`，没有修改运行中的 N8N/FastGPT。
- 正常入池继续要求 `aiScore >= 80` 且至少一个有效 phone/email；已有联系方式不触发反查。只有严格 `aiScore > 90` 且 phone/email 均无效时才进入联系方式 enrichment，90 分本身不触发。
- 联系方式搜索使用独立配置和 `contactSearchRound`；工作流显式展开三个 Round，每个百度 HTTP 节点之前再次检查 `contactSearchRound < contactSearchMaxRounds`，代码硬上限为 3、每轮 top_k 默认 5。Round 1 使用确定性企业全称 Query，Round 2/3 才调用单 Query Planner，成功后立即停止后续 Round。
- 百度结果先由 Code 节点提取大陆手机号、座机、国际号码和邮箱；完全没有候选时不消耗 Contact Verifier。Verifier 只能选择实际候选，平台客服、陌生号码、同名不同地区和无法证明企业归属的证据被拒绝。
- 验证证据明确时把 phone/email 回填到当前 validatedLead，并把标准全称 province/city 合并进现有 profile；N5 服务端仍用正式省市表再次校验后才自动分配销售。搜索轮次和 Query 不进入 N4 Lead 幂等键。
- FastGPT Planner/Verifier 的准确 Prompt、严格 JSON Schema 和人工配置步骤归档于 `docs/mcp/LEAD_CONTACT_ENRICHMENT_V1.md`，所有 App ID/Credential 均为占位符；本分支没有假装完成线上 Agent 配置。
- 未给共享 `lead_upsert` 增加联系方式强制门槛：现有 `BAIDU_SEARCH` 还不足以区分 N4 基线和 contact-enrichment-v1，强制校验会破坏旧 N4 写契约；因此本批把最终门槛留在新版本 N8N workflow，并明确报告后端版本化信号不足。没有扩大 SERVICE 身份权限，也没有改动 assignedUserId、Customer、Contract 等域。
- 新增 workflow/契约测试 2 文件 22 项、N3/N4 定向 9 文件 86 项、N5 assignment 定向 4 文件 49 项、全量 91 文件 615 项通过；Prisma validate/generate、TypeScript、ESLint（0 error、532 个既有 warning）、Next.js 110 个静态页面生产构建和 git diff check 通过。未修改 Prisma Schema/migration，未部署、未连生产数据库、未执行 GRANT。

## 2026-08-24｜第五批 N5 最终销售体验与 Lead 分配闭环（已开发、未部署）

- 分支 `codex/n5-final-ui-operations-polish` 固定基于已部署生产 SHA `436a330a826b7514e0482f2ce3f5c9e6d7583335`；本轮不进入 N6，不修改生产服务、数据库或 N8N/FastGPT 工作流。
- AI 线索池把面向用户的 “AI Score”/`feedbackVersion` 改为“AI 评分”/“反馈版本”，画像由独立展示模块按 summary、industry、intentLevel、evidence、业务数组、风险和建议字段渲染，同时兼容当前生产 profile 的 industry、intent、scale、contactability、confidence、reason；不再输出原始 JSON `<pre>`。
- 列表使用明确列宽、nowrap、关键词 truncate/title、整表最小宽度和横向滚动；新增当前页多选、SUPER_ADMIN 批量指派以及复用既有反馈事务的批量无效。批量无效逐条追加 `LeadFeedbackEvent`、增长 feedbackVersion，任一权限/版本失败会回滚整个批次。
- SUPER_ADMIN 可单条分配/改派真实启用的 SALES/FOREIGN_TRADE；后端重新校验角色和 active 状态，并用 OperationLog 区分 MANUAL_ASSIGN/REASSIGN。SALES/FOREIGN_TRADE 不能改派其他用户 Lead。
- 新建 Lead 的服务端自动路由只接受 profile 中通过标准省市表验证的 province/city；国内销售复用 CRM 用户 territories，`国外` 线索按现有 FOREIGN_TRADE 业务角色唯一匹配（多名外贸负责人时不随机分配）；零匹配、多匹配、地域缺失或路由查询不可用均保留未指派，并在既有 LeadWriteAudit action 中记录 AUTO_ASSIGN 或明确失败原因。REPLAY、CONFLICT 和同公司合并不会重新分配。
- 当前 FastGPT `lead-score-v1` 严格 profile 仍只有 industry、intent、scale、contactability、confidence、reason，尚不提供 province/city；因此现有生产输入会安全保持未指派。后续统一部署前，FastGPT/N8N 最小数据契约需要补充标准全称 `profile.province` 和可选 `profile.city`，本分支未修改其工作流。
- 自动路由不开放调用方 assignedUserId，也不增加 Lead UPDATE 权限；后续部署只需给 N3 写账号增加 `users(id,role,territories,isActive)` 列级 SELECT。未新增 Prisma Schema 或 migration。
- 本地 Prisma validate/generate、TypeScript、Lead 定向 16 文件 148 项、权限/ownership 7 文件 82 项、KPI 7 文件 67 项、N3/N4 9 文件 72 项、入库自动编号 2 文件 10 项、全量 89 文件 591 项、ESLint（0 error、532 warning）、Next.js 110 个静态页面生产构建、git diff check 以及 Standards/Spec 双轴复核均通过；未生成 Artifact、未连接数据库、未 push 前部署。

## 2026-08-20｜第五批 5B-KPI：工作台 KPI 卡片联动列表筛选（已开发、未部署）

- 分支 `codex/dashboard-kpi-filter-linkage` 基于已验收 5B SHA `28523c3ae2b63bb575345eca0079fa8f30e61a15`，只完成工作台四张 KPI 卡片到 Customers、Contracts、Shipments 列表的筛选联动；未开始第六批或其它 KPI 功能。
- Dashboard 复用既有周期算法，在 `range` 中增加按本地年月日格式化的 `startDate` 与包含式 `endDate`；修正版进一步按每张 KPI 的真实 where 分别透传省份、客户状态、合同状态、发货状态和销售范围，不把无关筛选机械塞入所有链接。
- Customers 新增 `createdStart/createdEnd`，使用本地当天零点 `gte` 与结束日期次日零点 `lt`，非法日期返回 400；Customers、Contracts、Shipments 均从 URL 首次初始化可见筛选 state，首个请求直接带入筛选，不通过 mount effect 二次覆盖。
- 合同金额、周期发货和逾期发货使用明确的 `kpiSalesUserId` 同时约束 `Customer.assignedUserId` 与 `Contract.salesUserId`；Customers 也使用同一 KPI 专用参数保留非管理员越权空集。用户修改或清空可见业务员筛选后会删除 KPI 专用 scope，普通列表原 `salesUserId/assignedUserId` 语义不变。
- Dashboard、Contracts、Shipments 共用合同状态 predicate，`PRODUCTION/SHIPPED` relation 语义保持一致；Dashboard 与 Contracts 继续共用逾期条件。新增筛选只与既有 businessLine/territory 权限取交集，越区域或他人销售参数只能返回空集，无参数列表行为保持不变。
- correction 核心测试 6 文件 79 项、完整 5B-KPI 集合 11 文件 95 项、5A/5B 回归 10 文件 95 项、N3/N4 回归 10 文件 101 项、全量 84 文件 541 项通过；Prisma validate/generate、TypeScript、ESLint（0 error、533 warning）、Next.js 107 个静态页面生产构建及 Spec/Standards 双轴复审均通过。
- 本轮没有修改 Prisma Schema 或 migration，没有连接数据库、执行 migration、部署服务器，也没有修改 Lead、MCP、N8N、FastGPT 或 3012/3013。

## 2026-08-20｜第五批 5B：AI 线索池前端 UI（已开发、未部署）

- 分支 `codex/lead-feedback-ui` 基于已验收 5A SHA `79991225da527189b71577920c55327e9e932857`，只完成 CRM 内 AI 线索列表、详情和单条人工反馈闭环；未开始 5C、KPI、批量操作、客户转换或外部工作流修改。
- 新增人类 Session `GET /api/crm/leads` 与 `GET /api/crm/leads/[id]`；列表、详情和既有 5A 反馈共同复用 ownership 模块，`SUPER_ADMIN` 全量，`SALES` / `FOREIGN_TRADE` 仅本人明确指派，未指派和他人 Lead 不可见，`PURCHASE` / `WAREHOUSE` 拒绝；详情在同一锁定事务内读取 Lead 与事件，防止改派插入两次查询之间。
- `/leads` 支持状态、AI Score、获客关键词、管理员指派人、创建日期和分页筛选；`/leads/[id]` 展示画像、来源/模型、当前摘要和不可变历史事件，旧事件 `reviewStatus=null` 明确显示“历史状态未记录”。
- 反馈 UI 与 5A 共用同一状态/原因码契约，提交当前 `expectedFeedbackVersion`；成功后刷新详情，409 明确提示“线索已被其他操作更新，请刷新后重试”并重新拉取最新版本，400/403/404 有独立前端反馈。
- 本轮没有修改 Prisma Schema 或 migration，没有连接数据库或部署；Prisma validate/generate、TypeScript、5B+5A 定向 10 文件 72 项、N3/N4 定向 10 文件 97 项、全量 78 文件 461 项、ESLint（0 error）和 Next.js 107 个静态页面生产构建通过。
- 本地浏览器验证了未登录 `/leads` 重定向到 `/login`，并补强了 API fetch 跟随登录页重定向的 401 识别；因本地没有 AUTH_SECRET、隔离测试数据库和测试账号，本次不声称完成带真实 Lead 数据的登录后视觉/业务验收。

## 2026-08-20｜第五批 5A：Lead 销售反馈后端闭环（已开发、未迁移、未部署）

- 分支 `codex/lead-feedback-backend` 基于已验收 SHA `8ff79d536a065dbcacf8c9e9d735e204e7224ec6`，只新增人类 Session 反馈后端，不包含 Lead 前端、KPI、客户转换、批量操作、N8N、FastGPT、3012/3013 或 MCP SERVICE 写工具修改。
- 新增 `POST /api/crm/leads/[id]/feedback`；反馈状态、原因码和 `OTHER` 备注使用应用层白名单校验，`PENDING` 不能作为人工反馈结果，审计主体始终取当前有效 Session 用户。
- `SUPER_ADMIN` 可反馈全部 Lead；`SALES` / `FOREIGN_TRADE` 仅可反馈 `assignedUserId` 明确等于本人的 Lead，未指派或指派给其他用户均拒绝，国内销售与外贸不会互相扩大范围。
- 单事务内以 `id + expectedFeedbackVersion + assignedUserId` 条件更新 Lead、原子 `feedbackVersion + 1` 并追加不可变 `LeadFeedbackEvent`；同版本并发只有一个成功，另一个返回 409，历史事件不更新或删除。
- 为保留每次事件的真实反馈状态，新增 migration `20260820140000_add_lead_feedback_event_status`，只给 `lead_feedback_events` 增加可空 `reviewStatus`；可空用于兼容既有历史事件且不伪造旧状态，本次未连接数据库、未执行 migration。
- 本地 Prisma validate/generate、TypeScript、Lead/MCP 定向 12 文件 125 项测试、全量 71 文件 421 项测试、ESLint（0 error）和 Next.js 105 个静态页面生产构建通过；构建仅保留既有 middleware 弃用提示与 uploads NFT 动态追踪 warning。
- 并发测试覆盖条件更新、原子 increment、同版本竞争、改派竞态和 P2034 映射；由于本轮禁止执行 migration 且未连接数据库，MySQL 5.7 的真实锁等待与事务回滚仍需在隔离 CI 数据库中复验。

## 2026-08-20｜Lead/MCP 与 DachuanPro UI/V2 基线集成（已融合并通过本地验证）

- 分支 `codex/lead-feedback-ui-integration` 以已验收 Lead/MCP 基线 `7b6d934` 为第一父提交，融合 UI/V2 集成基线 `28e810c`；本次只做基线集成，不开始第五批 Lead Feedback/UI 功能。
- Lead 数据模型、25 项 FULL_READ_ONLY 目录、独立 `lead_upsert` 写目录、SERVICE principal、幂等与公司去重、CREATED/REPLAY/CONFLICT 审计、最小写账号及 N3/N4 验收脚本全部保留。
- UI/V2 基线保留渐进式领域 API、CRM/ERP/管理员驾驶舱、统一待办与平台管理、入库作废、单据编号/打印/筛选、UI-M0 至 UI-M7、头像上传、销售目标和全局搜索；旧 URL 与原 CRM/ERP 权限仍需兼容。
- 权限入口继续每次从数据库读取有效用户；客户区域/业务线隔离由 `customer-permissions` 统一复用，ERP 角色矩阵、采购需求权限和入库作废职责分离同时保留。
- 为防止 UI 的 WAREHOUSE BOM/齐套权限隐式扩大已验收 MCP 调用面，MCP BOM 详情与即时齐套使用独立角色策略并继续仅允许 `SUPER_ADMIN`；相关 12 个测试文件 113 项测试及全量 69 个文件 392 项测试通过。
- 合并后 Prisma validate/generate、frozen lockfile、TypeScript、ESLint（0 error）、Next.js 105 个静态页面生产构建、`git diff --check` 和冲突标记检查通过；构建仅保留既有 middleware 迁移提示与 NFT 动态追踪 warning。
- 本次没有连接数据库、执行 migration、部署服务器，也没有修改 N8N、FastGPT 或 3012/3013 服务；生产部署状态不因代码合并而改变。

## 2026-08-17｜AI 线索池批次 04（已开发、Linux CI E2E 通过、本次未部署）

- 正在接通 N8N 清洗结果 → FastGPT Lead Score Agent → Lead Write Agent → SERVICE 断言 → N3 `lead_upsert`；不改 MCP 业务实现、Prisma Schema、migration 或写账号权限。
- FastGPT v4.15.1 v2 补丁保留人类断言路径，并仅对应用 allowlist 签发独立 audience/密钥/Redis 前缀/限流的 `lead:create` SERVICE 断言；私钥只允许 FastGPT Secret 挂载。
- 评分契约为模型无关严格 JSON。DeepSeek 是首发选择和 CI mock 名义，不是唯一模型；替换模型时更新 `sourceModelVersion` 并复跑同一验收。
- 已新增版本化 FastGPT/N8N 工作流、签发脚本、隔离 `lead-mcp`、模型 mock、Lead E2E Runner 和 N4 runbook；Score Agent 无 MCP 权限，Write Agent 整页校验后一次批写并独占 SERVICE allowlist。
- `7b6d934` 对应 GitHub Actions Run `32200120685` 已通过 MySQL 5.7、最小写权限、FastGPT SERVICE 断言、Lead 写入/合并/重放/审计、敏感信息扫描与隔离栈回滚；该结论是 CI E2E，不代表本次执行了正式部署。

## 2026-08-14｜AI 线索池批次 03（已开发、未迁移生产、未部署）

- 在 `codex/mcp-filter-argument-hardening` 上新增独立 `LEAD_WRITE_INTERNAL` 模式与 `lead_upsert` command 注册表；FULL_READ_ONLY 的 24 个业务只读工具和 FastGPT 25 项目录保持不变。
- 写权限只接受独立 audience、公钥验证、稳定 principalId 白名单及 `lead:create` scope 的 SERVICE 断言；人类（含 SUPER_ADMIN）不能调用，服务身份有独立 Redis 前缀和速率限制。
- `lead_upsert` 使用独立写账号和 `executeCommand`，支持最多 20 条严格校验；同键同哈希重放、同键异哈希冲突，并捕获 Prisma P2002 处理并发幂等/去重竞争。
- N3 后续兼容修正将业务去重收敛为严格规范化 companyName；新幂等键命中同企业时锁定并合并既有 root Lead，不新增第三条，关键词去重累积、联系方式只补空、评分画像可更新，仍不写正式客户或指派销售。
- 新增 additive `lead_write_idempotencies` 回执表保留每个合并请求的 replay/conflict 语义；旧 company+phone+email 指纹通过确定性 root 选择和 `dedupKey` 惰性迁移兼容，历史 `PENDING_REVIEW` 行不自动删除。
- 新 migration 只新增 `lead_write_audits`，不改批次 02 的 Lead/LeadFeedbackEvent 字段，也不扩展 `operation_logs`；CREATED、REPLAY、CONFLICT 均记录服务主体审计。
- CI 增加 MySQL 5.7 审计 migration up/down/up 与 Lead 写账号最小权限隔离验收；生产写账号授权、N3 内部脚本验收及回滚步骤见 `docs/mcp/LEAD_WRITE_N3_DEPLOYMENT.md`。

## 2026-08-14｜AI 线索池批次 02（已开发、未迁移生产、未部署）

- 分支 `codex/mcp-filter-argument-hardening` 新增 `Lead`、`LeadFeedbackEvent` 与来源、反馈状态、去重状态枚举；migration 为纯新增两张表，并提供会删除新表数据的显式 `rollback.sql`。
- 新增 `lead_list`、`lead_get`、`lead_stats` 三个只读工具，固定仅 `SUPER_ADMIN` 可调用；列表支持状态、来源、命中关键词、AI 评分区间、日期和分页，详情包含画像与不可变反馈事件，统计返回状态、来源和评分段分布。
- 隔离验收账号授权清单已加入 `leads`、`lead_feedback_events`，FULL_READ_ONLY 工具矩阵由 21 个业务工具扩展为 24 个；生产部署时仍必须单独给 `dachuan_mcp_read` 对两张新表授予 `SELECT`，否则会出现 MySQL 1142。
- GitHub Actions 增加 MySQL 5.7 migration up、唯一约束、down、再次 up 验证；本地 Docker 未运行，因此 MySQL 5.7 实库结论以本分支 CI 为准。
- 本地 Prisma validate/generate、TypeScript、185 项测试、ESLint（0 错误，511 条既有 warning）和 `git diff --check` 已通过；未连接生产数据库、未执行生产 migration、未修改服务器或部署。

## 2026-07-20｜FULL_READ_ONLY 可信身份只读工具适配（已开发、隔离验收通过、未部署）

- 分支 `codex/unified-readonly-mcp` 已在身份桥接 PoC 基础上适配现有 21 个 CRM/ERP 只读业务工具；`FULL_READ_ONLY` 模式目录为 `dachuan_identity_who_am_i` 加 21 个业务工具，共 22 个。
- 所有 `tools/call` 同时校验服务 Key、调用方 requestId 和用户短期断言；服务 Key 不绑定业务身份。工具参数使用严格 Schema 并拒绝可信身份字段，每次调用按断言 userId 实时读取用户状态、真实角色和数据范围。
- 角色枚举以现有 Schema 为准：`SUPER_ADMIN`、`SALES`、`FOREIGN_TRADE`、`PURCHASE`、`WAREHOUSE`；采购为 `PURCHASE`，项目不存在 `PROCUREMENT`。
- CRM 区域/业务线范围与详情 ID 合并下推到 Prisma `where`，详情使用字段白名单 `select`；列表最大 100 条并限制搜索、日期范围和应用等待时间。
- 21 工具 × 5 角色矩阵、越权、跨范围、停用、实时角色变化、身份参数伪造和双销售并发隔离均通过；FULL_READ_ONLY 隔离验收 `overallStatus=PASS`，OperationLog 抽检和最终敏感扫描 PASS。
- 本次未修改 Prisma Schema、migration、package.json 或 pnpm-lock.yaml，未连接生产数据库、未部署、未推送。详细结果见 `docs/mcp/FULL_READ_ONLY_TEST_REPORT.md`。

## 2026-07-17｜统一 Agent 可信身份桥接 PoC（已开发、未部署）

- 基于 `codex/unified-readonly-mcp` 的 `dd0338f`，新增 CRM 登录 Session → Agent Auth Gateway → FastGPT 4.15.1 请求上下文 → MCP `dachuan_identity_who_am_i` → `OperationLog` 的最小闭环。
- 用户断言为 Ed25519/EdDSA，默认 10 分钟，包含 kid/iss/sub/aud/iat/nbf/exp/jti；Redis 保存 JTI、撤销和限流状态。服务 Key 不再绑定业务用户，旧路径生产默认关闭。
- MCP 每次按签名 sub 实时查询 isActive、role、region、territories、viewScope；身份不来自模型变量、提示词、工具参数或全局变量。
- FastGPT 原生插件无法安全动态注入逐请求身份，已为精确 v4.15.1 提交提供可应用、可回滚的最小 AsyncLocalStorage 补丁和并发隔离测试。
- PoC 默认只暴露 `dachuan_identity_who_am_i`；搜索策略网关和既有 21 个只读业务工具的新身份权限矩阵尚未进入本阶段。未修改 Prisma/migration，未连接生产数据库、未部署、未推送。

## 2026-07-17｜统一只读 CRM/ERP MCP v1（已开发、未部署）

- 基于 `29d92da` 新增一个 Streamable HTTP MCP 地址，按 CRM/ERP 模块提供客户、跟进、产品、合同、发货、供应商、采购订单、库存、出入库、BOM、生产工单和齐套检查共 21 个只读工具。
- 初版曾将 API Key 哈希绑定现有用户；该认证方式已被上方可信身份 PoC 取代，生产环境禁止开启，仅保留非生产隔离测试兼容路径。
- 所有协议调用与鉴权拒绝写入现有 `OperationLog`；不新增表、字段或 migration。即时齐套仅计算，不保存结果或变更库存。
- 新增 Docker、环境变量、Nginx、FastGPT 4.15.1 接入与测试文档；独立容器仅监听本机 3010，建议由独立域名反向代理到 `/api/mcp`。
- 本功能尚未部署，未连接生产数据库，未修改任何业务数据；最终全量测试结果见 `docs/mcp/TEST_REPORT.md`。

## 2026-08-03｜DachuanPro v2.0.0-rc1 阶段 0 审计与设计（已提交，未合并、未构建、未部署）

- 分支：`codex/v2-audit-design`，基线：`origin/codex/agent-canary-integration` 的 `adfc3bd`。
- 仅新增阶段 0 设计文档：实施计划、API 领域/兼容盘点、MCP 候选、数据库计划和选配项齐套审计；没有修改业务代码、schema、migration、CI、上传文件或服务器配置。
- 审计确认当前 CRM 工作台、ERP Phase 4、DB 刷新的权限模型和 Agent assertion 必须作为 2.0 兼容基线；入库作废、统一待办、权限矩阵和配置中心尚未实施。
- 未运行依赖安装、Prisma 生成、TypeScript、测试或构建：本阶段无代码/schema 变更，且未收到构建指令。

## 2026-07-13｜ERP 第四期：生产工单受控闭环（待数据库迁移与部署）

- 已在 `codex/erp-phase4-production-kit-check` 完成工单草稿、下达、BOM 物料快照、独立齐套检查历史、领料/退料和缺料采购草稿来源关联。
- 已下达工单只能经变更申请和超级管理员审批生成新版本；审批同时保留旧版本/快照、生成新快照并新建齐套记录。
- 已删除生产进度百分比和开工、暂停、完工等生产状态机，也未引入合同台套分配或数量占用。
- 数据库迁移只新增生产工单、变更申请、物料快照、齐套记录，以及既有入/出库和采购草稿的可空来源关联字段、索引和外键；尚未在任何数据库执行。
- 上线前必须先备份数据库，并人工复核 `prisma/migrations/20260713090000_erp_phase4_production_part_a/migration.sql`、`prisma/migrations/20260713110000_erp_phase4_purchase_sources/migration.sql` 与 `prisma/migrations/20260713120000_erp_phase4_shortage_purchase_source_guard/migration.sql`，不得执行 `db:reset`。
- 已新增物料级缺料采购来源唯一约束：同一齐套检查、同一物料仅允许一个活动采购来源；取消或软删除草稿会释放活动占位，历史来源保留。

## 2026-07-15｜ERP 第四期验收增强（已开发，未迁移、未部署）

- 分支：`codex/erp-phase4-procurement-delivery-enhancements`。
- 已增加合同明细交期与生产工单交期快照、库存变化齐套复检队列、安全库存采购需求、备货/工单/月度计划/手工四类采购来源、月度生产计划、入出库业务快照与附件、库存调拨、供应商交期跟踪/承诺历史/分批交付/提醒/绩效。
- 月度计划部分转工单会记录计划需求、正式工单和采购明细的数量分摊；交付批次实际到货只由确认采购入库核销，采购状态不能手工伪造为部分/全部到货。
- 附件上传按实体存在性、采购负责人/仓库角色/管理员权限和文件扩展名、MIME、大小校验；正式库存单据附件删除仅允许超级管理员且写操作日志。
- 原有生产工单、齐套历史、领退料、采购订单与缺料来源表均保留；新采购需求层在正式采购订单之前工作，不会自动生成正式订单。
- 新迁移为 `prisma/migrations/20260715100000_erp_phase4_procurement_delivery/migration.sql`，回滚脚本同目录 `rollback.sql`；均未在任何数据库执行。
- 本地 Prisma 校验、TypeScript、50 项测试和 Next.js 生产构建通过；Windows 本地 standalone 启动受 pnpm 符号链接 `EPERM` 阻断，需在 Linux CI 再执行干净环境 `/login` 冒烟。

## 2026-07-16｜ERP 采购与用料流程验收修正（已开发、未部署）

- 分支：`codex/erp-phase4-procurement-delivery-enhancements`。
- 整机用料清单恢复为纯主数据维护，已删除缺料测算、生成采购建议页面和旧直达采购订单草稿接口；生产工单齐套检查后改为一次确认批量生成采购需求。
- 采购需求页面已补齐勾选需求、指定供应商并生成采购订单草稿的入口，生成结果可直接跳转查看。
- 月度生产计划只允许主产品，审核只冻结用料需求，不自动生成采购需求；新增“月度生产计划备件预测”二级入口，复用现有采购需求表且未新增迁移。
- 所有 ERP 设备型号入口增加主产品前端过滤与后端校验；采购需求、库存调拨和物料导入冲突处理等物料选择统一支持搜索。
- 新增入库、出库表单均显示单一“附件”按钮；移动端交由系统原生选择拍照、相册或文件，单据创建后上传，附件失败不回滚库存单据并可在详情重试。
- 本次没有修改 `prisma/schema.prisma`、迁移脚本或任何数据库数据；本地 TypeScript、57 项测试和 Next.js 生产构建通过，尚未部署。

## 2026-07-17｜ERP 表单布局与用料层级验收修正（已开发、未部署）

- 分支：`codex/erp-phase4-acceptance-layout-bom-fixes`。
- 采购需求、库存调拨不再使用会挤压物料选择框的等宽五列布局；共享物料选择器允许随容器收缩，并同步处理入库、出库、月度备件预测在平板和窄桌面宽度下的潜在重叠。
- 整机用料清单的查看明细改为树形缩进及“零件包 / 子物料 / 整机物料”标识；向零件包添加子物料时可在选择窗口逐项填写加入数量，并明确规格文字不会自动拆成独立物料。
- 库存管理侧栏按生产、库存、物料、采购、供应商、计划、仓库及审批的确认顺序重新排列；新增供应商时名称、联系人和联系电话均由前端和 API 校验为必填，历史空值记录仍可继续编辑且不会被批量改写。
- 月度生产计划的计划月份改为月份选择并规范化保存为当月首日；原有计划开始、完成日期逻辑未改，只补充“计划开始日期”“计划完成日期”标签。
- 本次未修改 Prisma schema、迁移脚本、数据库数据、上传文件或服务器配置；本地 TypeScript、67 项测试、ESLint（0 错误）和 Next.js 生产构建通过，尚未部署。

## 2026-09-05｜小川第 3 期 A 段：Agent 登录界面 + 独立账号体系 + Agent 管理（已开发，本地验收中，未部署）

- 分支：`codex/xiaochuan-agent-phase2`，提交 `7d204473`（主体）+ 本次收尾提交。
- 新增 `agent_accounts`（独立账号名单，与 CRM users 表完全分离）、`agent_usage_daily`（按北京时间自然日限额）、`agent_model_configs`（多套模型配置单套生效，API Key AES-256-GCM 加密存储）、`agent_account_audit_logs`（Agent 账号工具审计）四表；`agent_conversations` 增加双归属（userId 可空 + agentAccountId），migration `20260904180000`（rollback 先恢复 NOT NULL 防半回滚）与 `20260904190000`（sessionVersion：管理员重置密码后旧 Cookie 立即失效）。
- 登录界面 `/xiaochuan`：左侧 logo + Welcome Back！（与 hero 同款渐变字）+ 副标题「请输入账号和密码登录DachuanPro Agent」+ 账号/密码/记住账号，右侧沿用首页 Spline 机器人；未登录不再跳 CRM 登录页（middleware 放行 /xiaochuan 与 /api/agent/，接口内部双身份校验）。
- 双身份：CRM 员工（NextAuth 会话）平台内跳转免登录直达对话；Agent 独立账号（独立 HS256 Cookie 30 天）登录后仅知识工具可用（McpRole 新增 AGENT_ACCOUNT，业务工具角色矩阵恒拒 + 执行器再校验），业务数据隔离经真机问答验证。
- 登录回退语义：用户名不在 Agent 名单（NOT_AGENT_ACCOUNT）才回退 CRM 员工认证；名单内密码错误不回退，防同名串用。
- Agent 账号每日限额默认 50 问（agent-review 验收账号 10 问），超限 429 中文提示；CRM 员工沿用 10 问/分钟。
- 附件归属加固（Codex 阻塞修复收尾）：新上传按 `xiaochuan/{crm|agent-account}/{归属ID}/` 多层目录落盘；parseChatAttachments 按 viewer 强校验归属 ID（Agent 账号拒绝一切旧扁平路径），vision 读取支持三层形态并做 realpath 纵深防御；回归测试补齐。
- CRM「平台管理 → Agent 管理」（仅超管）：Agent 账号新增/编辑/重置密码/停用启用（软删，只加不删）；模型与 API Key 多套配置、测试连接（编辑时 Key 留空复用存量密钥但按表单地址/模型测试）、一键切换生效（即时生效无需重新部署），env 配置永远兜底。
- 门禁：tsc 0 错、vitest 864/864、eslint 0 错（599 条既有 warning）、next build 通过；浏览器端到端验收（登录页布局/双身份登录/知识问答/业务隔离/退出/Agent 管理页）全部通过。
- 待办：用户 localhost 审核确认 → 出部署包（含 01/02 SQL 与部署说明）→ 挂 ai.dachuan.pro 子域名（NEXT_PUBLIC_XIAOCHUAN_URL 构建期改写 + Cookie 域 .dachuan.pro，员工会被登出一次）→ 智谱搜索/网页读取 MCP 接入。
