# DachuanPro V2.0 第 4 阶段施工计划：业务体验与编号

## 0. 基线与边界

- 已执行 `git fetch origin --prune`，施工分支 `codex/v2-business-improvements` 直接从 `origin/codex/dachuanpro-v2.0-integration` 的 `42da5d0` 创建；当前 HEAD 即该提交。
- 未触及 `main`。工作树原有未跟踪目录 `output/`、`public/images/` 保留不动。
- 本计划阶段只新增本文档；未修改业务代码、`package.json`、Prisma schema/migration、权限矩阵、middleware 或 Agent/MCP。

## 1. 已核对的现状

- 入库、出库 API 与页面已经实现：仓库、类型、日期范围、单号/物料关键字、分页筛选。因此本阶段只增加创建人和状态，不重写已有筛选。
- 合同编辑器调用 `/api/customers?pageSize=500` 并使用原生下拉；客户 API 已支持 `search` 与分页。
- 生产工单页面启动时加载最多 100 个合同、全部主产品和最多 200 个 BOM；关联合同只按合同号后端筛选，设备 API 尚无搜索参数；未选设备型号时备货 BOM 下拉会显示所有启用 BOM。
- 生产工单草稿使用 `DRAFT-uuid`，发布会将其替换为合同序号或 `MO日期-流水`；入库、出库使用 `IN/OUT日期+随机串`；采购、盘点、调拨使用 `PO/CK/TR日期+随机串`。现有各单号字段均已有数据库唯一约束。
- 入/出库没有独立状态字段，创建即确认且立即影响库存；因此状态筛选将明确为派生的“已确认（confirmedAt 存在）”，不伪造草稿/作废状态。
- 配置中心和 `SystemSetting` 已存在白名单与审计日志能力，适合保存编号规则，无需新增表或字段。

## 2. 施工文件与实现方案

### A. 搜索、BOM 与侧边栏

预计修改/新增：

- `src/components/contracts/contract-editor.tsx`，新增轻量远程客户搜索选择器（可抽到 `src/components/customers/customer-search-combobox.tsx`）。首次及输入关键词均请求 `/api/customers?search=<keyword>&pageSize=50`；保留已选客户展示和现有 CRM 权限，不再装载 500 条客户。
- `src/app/api/erp/production-contracts/route.ts`：将 `search` 扩展为合同编号、客户名称、主产品型号/名称的受限查询，并限制返回生产所需字段；不返回地址、金额、回款等客户敏感资料。
- `src/app/api/erp/products/route.ts` 与 `src/app/(app)/erp/production-orders/[id]/page.tsx`：主产品改为按型号/中文名称的按需搜索；合同选择改为远程搜索，不以首批 100 条充当全集。保留合同设备数量、权限和幂等创建规则。
- `src/app/(app)/erp/production-orders/[id]/page.tsx`：备货工单未选设备型号时，BOM 选择控件为空、禁用并显示“请先选择设备型号”；选定型号后仅请求/展示该型号 `isActive=true` 的版本。合同明细已有的按产品启用 BOM 逻辑保持。
- `src/components/layout/sidebar.tsx`：在导航点击发生前可靠记录导航容器滚动位置，并在 pathname 切换后恢复；处理桌面/移动菜单关闭，避免跳转后回到顶部。

### B. 单据编号

预计新增 `src/lib/document-number.ts`（名称可因现有测试组织微调），集中负责：输入 `trim`、手动编号校验、每日流水计算、白名单规则校验、Prisma 唯一冲突识别和有限重试。所有金额继续由现有 `Prisma.Decimal` 路径处理。

手动编号：

- 修改 `src/app/(app)/erp/production-orders/[id]/page.tsx`、`src/app/api/erp/production-orders/route.ts`、`src/app/api/erp/production-orders/from-contract/route.ts`、`src/app/api/erp/production-orders/[id]/route.ts`、`src/app/api/erp/production-orders/[id]/issue/route.ts`：新建/批量新建显示并提交必填工单号；服务端 trim 后写入，重复由唯一约束返回 409，发布不得再覆盖用户编号。仅有发布工单权限的用户可操作；已发布工单沿用现有变更审批，不能改号；草稿允许改号且写入完整 before/after 操作日志。历史 `DRAFT-*` 和既有正式号完全不回填。
- 修改 `src/app/(app)/erp/stock-in/page.tsx`、`src/app/api/erp/stock-in/route.ts` 与 `src/app/(app)/erp/stock-out/page.tsx`、`src/app/api/erp/stock-out/route.ts`：新建表单添加必填入/出库单号，后端 trim、全局唯一冲突 409，绝不生成或覆盖该用户输入。入/出库一经创建已实时产生库存及后续引用，禁止任何改号；创建操作日志将完整记录手动编号和单据快照，避免引入可误改历史库存单据的入口。

自动编号：

- 修改采购订单两条创建路径：`src/app/api/erp/purchase-orders/route.ts`、`src/app/api/erp/purchase-demands/convert/route.ts`；修改 `src/app/api/erp/stock-checks/route.ts` 和 `src/app/api/erp/stock-transfers/route.ts`。保留 `PO`、`CK`、`TR` 前缀及日期主体，改为“日期 + 每日补零流水号”；用户请求体不接受覆盖编号。
- 生成在事务中读取当日同前缀最大序号；利用现有 `@unique` 约束兜底，遇到唯一冲突/序列化冲突最多重试三次后返回 409。历史随机后缀单号保持不动，并按可解析的同日序号兼容计算。
- 修改 `src/modules/system/settings/service.ts`、`src/app/(app)/admin/config/page.tsx`（及只需的现有 `/api/system/settings`）：仅新增 `documentNumberRules` 一个设置键，并只接受 `prefix`、`dateFormat`、`sequenceLength`、`separator`、`resetCycle` 五个字段；仅超级管理员可保存，复用现有审计日志。默认值固定为当前 PO/CK/TR 前缀、按日重置、`yyyyMMdd`、3 位流水，首版不开放单据类型、表名或任意模板表达式。

### C. 出入库与库存台账筛选

- 修改 `src/app/api/erp/stock-in/route.ts`、`src/app/api/erp/stock-out/route.ts` 及对应两个页面：在既有 where 和 URL 参数上追加 `createdById` 与派生 `status=CONFIRMED`，补回创建人显示/选择所需的安全用户摘要；保留原有日期、类型、单号、仓库和分页实现，不改变其含义。
- 修改 `src/modules/erp/inventory/service.ts`、`src/app/(app)/erp/inventory/page.tsx`：补齐物料分类、库存预警、零库存、有需求无库存的参数和控件。最后一项定义为“当前库存数量为 0，且存在未取消、尚有未转换数量的采购需求”，后端以 `PurchaseDemand` 的状态/数量判断，避免仅靠前端猜测。现有搜索、仓库与 `alertOnly` 保持兼容。

### D. 打印当前筛选结果

- 修改 `src/app/(app)/erp/stock-in/page.tsx`、`src/app/(app)/erp/stock-out/page.tsx`、`src/app/(app)/erp/inventory/page.tsx`，可新增局部样式文件或在现有全局样式中追加最小 print 规则（以实施时实际样式组织为准）。
- 打印按钮只调用 `window.print()`；打印前以当前筛选参数请求全部受权限约束的结果（上限和提示防止无界导出），使用 `.print-hidden` / `@media print` 隐藏侧栏、按钮、页签、筛选控件和弹窗，打印标题展示筛选条件。不新增第三方打印依赖。

## 3. 数据库、权限、middleware 与回滚

| 项目 | 本阶段结论 | 理由与回滚 |
| --- | --- | --- |
| `prisma/schema.prisma` / migrations | 不修改 | 所有六个编号字段已有唯一约束；编号规则复用 `SystemSetting` JSON。回滚为撤回应用代码，历史单据不改写。 |
| 权限函数 | 不修改 | 仅复用 `canPublishProductionOrder`、`canManageInventory`、`canManagePurchaseOrders` 和配置中心管理员校验。 |
| `src/middleware.ts` | 不修改 | 没有新增页面或公开路由。 |
| Agent/MCP | 零改动 | 严格排除 `src/modules/agent/*` 与 `src/app/api/agent/*`。 |

若审查要求将入/出库状态扩展为真正的草稿、确认、作废状态，才需要纯增量 ENUM/列/迁移；那会改变库存状态机，不属于本计划，必须先另行获批。

## 4. 测试与提交节奏

1. 搜索、BOM、侧边栏：组件/API 断言，确认客户不再请求 500 条、合同/机型可按关键字搜索、未选型号无 BOM。
2. 编号：新增单元/API 测试覆盖 trim、必填、三类手动编号重复 409、工单草稿改号日志及发布不覆盖、入/出库不可改号、PO/CK/TR 的日流水、并发唯一冲突重试、拒绝手动覆盖和配置白名单；至少以 SUPER_ADMIN、PURCHASE、WAREHOUSE、SALES、FOREIGN_TRADE 验证接口访问边界。
3. 筛选和打印：保留 42da5d0 已有参数的回归断言，新增创建人/确认状态、六类库存筛选与当前筛选结果打印的浏览器检查。
4. 每个逻辑闭环一个清晰 commit；最后才执行用户指定的 `pnpm install --frozen-lockfile`、`pnpm exec prisma generate`、`npx tsc --noEmit`、`pnpm test`、`pnpm build`。仅全部通过后推送本分支，随后停止等待 Claude 复核；不合并、不打包、不部署。

## 5. 主要风险

- 单据号从随机后缀切到日流水会提高并发冲突概率：以数据库唯一约束、事务和有限重试处理，绝不靠前端计数。
- 手动编号会使人为重复成为常态：前后端都 trim，后端为最终 409 判定，并保留审计记录。
- 入/出库状态目前不是完整状态机：本次仅提供真实可判断的“已确认”筛选，避免为了筛选擅自扩展库存业务语义。
- 打印大量筛选结果可能造成浏览器卡顿：输出当前受权限约束结果并设置明确上限/用户提示，超限不静默截断。
