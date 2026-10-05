# DachuanPro V2.0 第5阶段：入库作废施工计划书

> 状态：仅供复核，尚未修改任何业务代码、`prisma/schema.prisma` 或 migration。
>
> 基线：`origin/codex/dachuanpro-v2.0-integration` @ `65e5aff2256f7c11b933af8be3aec38b2161b007`。
>
> 分支：`codex/v2-stock-in-void`。本计划不涉及 main、版本号、middleware、Agent/MCP。

## 1. 现状核对（65e5aff）

### 1.1 StockIn 字段与当前状态来源

| 项目 | 现状与证据 |
| --- | --- |
| 单头 | `StockIn` 只有 `batchNo`、仓库/来源、类型、备注、创建人、`confirmedById`、`confirmedAt`、快照和创建时间；没有 `status`、`voidedAt` 或作废原因。见 `prisma/schema.prisma:848-872`。 |
| 单据明细 | `StockInItem` 持有数量、金额、物料/仓库快照及入库前后数量快照；采购收货分配表以它为外键。见 `prisma/schema.prisma:874-899`。 |
| 台账 | `Inventory.quantity`、`totalAmount`、`avgPrice` 使用 Decimal；库存流水含正负数量、前后数量、来源类型/ID，但没有金额字段。见 `prisma/schema.prisma:829-844`、`991-1013`。 |
| 创建即确认 | 创建入库单时，API 同时写 `createdById`、`confirmedById` 与 `confirmedAt: new Date()`。见 `src/app/api/erp/stock-in/route.ts:247-258`。 |
| 当前“已确认”派生 | 第4阶段 GET 只允许 `status=CONFIRMED`，其实际 where 条件是 `confirmedAt != null`；没有草稿/作废查询。见 `src/app/api/erp/stock-in/route.ts:77-105`。 |
| 页面现状 | 历史列表仅有“已确认”筛选；详情将状态硬编码为“已提交”。“纠错/作废”目前只是说明性弹窗，明确提示尚无 `status/voidedAt/voidReason` 和反向流水。见 `src/app/(app)/erp/stock-in/page.tsx:331-423`、`454-466`。 |

### 1.2 入库影响库存的路径

1. 同一 `Serializable` 事务先拍下每行物料、仓库和入库前数量，见 `src/app/api/erp/stock-in/route.ts:236-286`。
2. 对每一行，现有实现 `upsert` 库存，增加数量和金额并重算平均价，见 `src/app/api/erp/stock-in/route.ts:288-326`。
3. 紧接着新增不可变的 `StockMovement`：`type=STOCK_IN`、正数量、`refType=StockIn`、`refId=单头ID`，见 `src/app/api/erp/stock-in/route.ts:328-341`。
4. 采购入库还会增加采购明细 `receivedQuantity`、分配收货批次、回写采购订单状态，见 `src/app/api/erp/stock-in/route.ts:344-370`；生产退料会按所有关联入库单计算已退数量，见 `src/app/api/erp/stock-in/route.ts:196-216`。
5. 最后写操作日志并触发齐套复查队列，见 `src/app/api/erp/stock-in/route.ts:373-387`。

因此，本阶段**不能**删除/改写原 `StockIn`、`StockInItem` 或其 `STOCK_IN` 流水，更不能重算历史库存。作废只能在当前库存上追加一笔新的、可审计的反向业务事实。

### 1.3 已有来源关联与安全边界

| 关联 | 现状 | 第5阶段首版策略 |
| --- | --- | --- |
| 采购订单 | 现有“撤销采购关联”会锁采购单、只允许最近一次入库、反向收货分配/到货数量并重算订单状态，但**不**回退库存，见 `src/app/api/erp/stock-in/[id]/unlink-purchase/route.ts:23-107`；其中收货分配反转当前会物理删除分配行，见 `src/lib/purchase-delivery-receipts.ts:21-27`。 | 直接作废 `purchaseOrderId != null` 的单据一律返回 409。首版不复用该删除型分配逻辑，也不改采购收货口径；若业务确需，应先按现有严格“撤销采购关联”完成采购侧纠正，再按后续审批的独立路径处理库存。 |
| 生产退料 | 生产工单、领料及变更审批都会汇总关联 `StockIn` 作为已退料量，见 `src/app/api/erp/stock-in/route.ts:196-216`、`src/lib/production-orders.ts:417-420`、`src/app/api/erp/production-order-change-requests/[id]/approve/route.ts:24-29`。 | 直接作废 `productionOrderId != null` 的单据一律返回 409，避免把已退料重新计入/漏计入生产领退料。 |
| 后续库存使用 | 后续出库按当前库存和移动平均价扣减，见 `src/app/api/erp/stock-out/route.ts:244-277`；调拨也会先验证可用数量，见 `src/app/api/erp/stock-transfers/route.ts:21-24`。 | 作废前逐物料锁住库存并要求 `current.quantity >= 原入库数量`；否则返回 409，不产生任何作废记录、库存变动或流水。 |

这使第一版只对“无采购来源、无生产退料来源”的普通/期初/盘盈/其他入库开放作废。该收窄是刻意的风险控制，不是静默漏处理：前端与 API 都会说明被来源业务引用的单据需走来源模块的专用纠正流程。

## 2. 状态机与数据设计

### 2.1 状态机

新增 `StockInStatus = DRAFT | CONFIRMED | VOIDED`，并在 `StockIn` 增加状态和作废摘要字段。

```text
（预留，不由第5阶段 POST 创建）DRAFT
              │ 确认
              ▼
POST /stock-in ─────────────► CONFIRMED ── 作废事务 ──► VOIDED
                                 │                         │
                                 │                         └─ 原单、原入库流水永远保留
                                 └─ 创建即确认，立即影响库存
```

- `DRAFT`：仅为完整状态域与未来草稿能力预留；第5阶段没有创建/编辑草稿 API，不能借此改变“创建即确认”。
- `CONFIRMED`：唯一可影响库存的正常入库状态。新 POST 显式写入 `CONFIRMED`，并继续同时写 `confirmedById/confirmedAt`；行为与第3/4阶段相同。
- `VOIDED`：原入库事实仍可查询、打印和审计，但不再代表有效入库；作废事务另写一组反向库存流水和不可变作废审计记录。
- 合法公开转换仅为 `CONFIRMED -> VOIDED`。`DRAFT -> CONFIRMED` 预留而不暴露；禁止 `VOIDED -> CONFIRMED` 的普通接口，避免篡改审计历史。

### 2.2 拟新增模型/字段（均为增量）

1. `StockIn.status`：`StockInStatus`，`NOT NULL DEFAULT CONFIRMED`。
2. `StockIn.voidedAt`、`voidedById`、`voidReason`：便于列表/详情/打印直接展示作废摘要；不建立到 User 的新反向关系，避免改变既有 User 关系模型。
3. 新表 `erp_stock_in_voids` / Prisma `StockInVoid`：一张入库单最多一条作废记录（数据库唯一约束），作为并发幂等闸门和作废审计头。
4. 新表 `erp_stock_in_void_items` / Prisma `StockInVoidItem`：保存每行的原入库明细、反向数量、按**作废时当前移动平均价**计算的反向金额、作废前后库存。这避免为了记录金额而修改既有 `StockMovement` 表。
5. 反向流水复用既有 `StockMovementType.STOCK_OUT`，`quantity` 为负，`refType='StockInVoid'`，`refId=StockInVoid.id`；不追加/修改既有库存流水 ENUM。

选择“状态标记 + 新反向流水 + 新作废审计表”，而不是只改状态的原因是：只改状态会让 `erp_inventories` 仍保留错误数量；重写旧流水会破坏总账可追溯性。新流水可完整显示“原入库 → 作废冲减”链路，且原始 `STOCK_IN` 不变。

### 2.3 存量数据迁移策略

- `status` 以 `NOT NULL DEFAULT 'CONFIRMED'` **新增**。迁移不执行 `UPDATE erp_stock_ins`、不修改 `erp_inventories`、不修改 `erp_stock_movements`。
- MySQL 对既存行填入该新增列的默认值 `CONFIRMED`；已有 `confirmedAt`、`StockInItem`、库存数和历史流水全部原样保留。
- API 在迁移后以 `status` 为权威筛选字段；历史行因默认值即为 `CONFIRMED`，不会被误判为草稿/作废，也不会触发任何库存数值跳变。
- 迁移前必须作只读核验：`SELECT COUNT(*) FROM erp_stock_ins WHERE confirmedAt IS NULL`。即使存在旧异常行，仍默认 `CONFIRMED` 以守住“历史入库已影响库存”的不变量；异常只记录在上线核验报告，不做数据回写。

## 3. 作废事务实现路径（后续施工，非本次修改）

拟新增 `POST /api/erp/stock-in/[id]/void`，请求体只允许 `{ reason: string }`；原因 trim 后必填、长度限制为 5–500 字。客户端不可提交状态、数量、金额、作废人或时间。

在 `Prisma.TransactionIsolationLevel.Serializable` 内按以下顺序执行，遇到任何失败整体回滚：

1. 读取当前会话用户并调用新增的窄权限 `canVoidStockIn`；再检查作废人未参与该单审核（`stockIn.confirmedById !== user.id`）。
2. 以 `SELECT ... FOR UPDATE` 锁定 `erp_stock_ins` 单头，读取明细；要求 `status=CONFIRMED`、`confirmedAt != null`、`voidedAt IS NULL`。
3. 拒绝 `purchaseOrderId != null` 或 `productionOrderId != null` 的来源单据（409）；拒绝空明细、已不存在库存行或已低于原入库数量的任一物料（409）。
4. 按 `materialId` 固定升序 `FOR UPDATE` 锁定对应 `erp_inventories`，防止与入/出库、盘点、调拨交错；所有数值使用 `Prisma.Decimal`，不引入浮点。
5. 对每行按当前移动平均价 `current.totalAmount / current.quantity` 算出反向金额，更新库存为：`quantity - original.quantity`、`totalAmount - reversalAmount`，结果不得为负；新平均价为 `afterAmount / afterQty`（零数量时为 `null`）。这与现有出库移动平均价扣减口径一致（`src/app/api/erp/stock-out/route.ts:244-261`），而不是错误地从已混合后的账面直接减去历史原始金额。
6. 创建唯一的 `StockInVoid` 头与其 `StockInVoidItem` 行；随后新增每行 `StockMovement(type=STOCK_OUT, quantity=-original.quantity, refType=StockInVoid, refId=voidId)`。旧 `STOCK_IN` 行绝不更新或删除。
7. 将原 `StockIn` 更新为 `VOIDED`，填写 `voidedAt/voidedById/voidReason`；写 `VOID_STOCK_IN` 操作日志（before 包含原状态、库存快照和来源，after 包含作废记录/反向流水 ID），并用相同物料触发齐套复查队列。
8. 对 `P2002`（唯一作废记录）和 `P2034`/死锁有限重试最多 3 次；最终已作废/并发冲突返回 409，不允许第二条反向流水。

作废不会回退或重算任何历史流水；它仅在当前库存上追加新的反向冲减事实。作废后库存台账/流水按当前记录展示余额，审计明细保留原始入库数量和实际冲减金额。

## 4. 拟议 migration SQL 全文（仅计划，待复核后才可创建文件）

目标文件名拟为：`prisma/migrations/2026080x120000_v2_phase5_stock_in_void/migration.sql`。日期序号在实际施工开始时以仓库最新 migration 为准，不预占当前文件。

### UP（唯一会进入生产的方向）

```sql
-- 1) 只给既有入库头增加新状态和作废摘要；默认 CONFIRMED 保护所有历史入库。
ALTER TABLE `erp_stock_ins`
  ADD COLUMN `status` ENUM('DRAFT','CONFIRMED','VOIDED') NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN `voidedAt` DATETIME(3) NULL,
  ADD COLUMN `voidedById` VARCHAR(191) NULL,
  ADD COLUMN `voidReason` TEXT NULL;

-- 2) 只新增索引，不改任何既有索引或约束。
CREATE INDEX `idx_stock_in_status` ON `erp_stock_ins`(`status`);

-- 3) 新建作废头；唯一 stockInId 为并发作废的数据库兜底。
CREATE TABLE `erp_stock_in_voids` (
  `id` VARCHAR(191) NOT NULL,
  `stockInId` VARCHAR(191) NOT NULL,
  `voidedById` VARCHAR(191) NOT NULL,
  `reason` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_stock_in_void_stock_in`(`stockInId`),
  INDEX `idx_stock_in_void_created`(`createdAt`),
  CONSTRAINT `fk_stock_in_void_stock_in`
    FOREIGN KEY (`stockInId`) REFERENCES `erp_stock_ins`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4) 新建不可变作废行审计；只引用既有明细/物料，不改它们。
CREATE TABLE `erp_stock_in_void_items` (
  `id` VARCHAR(191) NOT NULL,
  `stockInVoidId` VARCHAR(191) NOT NULL,
  `stockInItemId` VARCHAR(191) NOT NULL,
  `materialId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(10,2) NOT NULL,
  `reversalAmount` DECIMAL(12,2) NOT NULL,
  `beforeQty` DECIMAL(10,2) NOT NULL,
  `afterQty` DECIMAL(10,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_stock_in_void_item_original`(`stockInVoidId`,`stockInItemId`),
  INDEX `idx_stock_in_void_item_material`(`materialId`),
  CONSTRAINT `fk_stock_in_void_item_header`
    FOREIGN KEY (`stockInVoidId`) REFERENCES `erp_stock_in_voids`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_in_void_item_stock_in_item`
    FOREIGN KEY (`stockInItemId`) REFERENCES `erp_stock_in_items`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_stock_in_void_item_material`
    FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

UP 逐项边界说明：第 1 段只有 `ADD COLUMN`；第 2 段只有 `CREATE INDEX`；第 3、4 段只有 `CREATE TABLE` 及新表内部索引/外键。没有 `DROP`、`TRUNCATE`、`DELETE`、`UPDATE`、既有列 `MODIFY` 或既有约束变更；`erp_inventories` 和 `erp_stock_movements` 不在 migration 中。

### DOWN（仅用于未产生任何第5阶段作废数据的预发布回退演练）

Prisma/MySQL 没有自动 down；以下 SQL 作为可执行回退脚本留在 migration runbook。它只移除本 migration 新增的对象。**生产一旦存在 `VOIDED` 单据或 `erp_stock_in_voids` 数据，禁止执行 DOWN**，应采用第 7 节的业务补偿回退，确保审计和流水不丢失。

```sql
-- 前置硬门：结果必须为 0，否则停止，不执行任何 DOWN。
SELECT COUNT(*) AS `phase5_void_count`
FROM `erp_stock_ins`
WHERE `status` = 'VOIDED';

-- 仅在上述结果为 0 且新表为空的预发布环境执行；按依赖逆序移除第5阶段新增对象。
DROP TABLE `erp_stock_in_void_items`;
DROP TABLE `erp_stock_in_voids`;
DROP INDEX `idx_stock_in_status` ON `erp_stock_ins`;
ALTER TABLE `erp_stock_ins`
  DROP COLUMN `voidReason`,
  DROP COLUMN `voidedById`,
  DROP COLUMN `voidedAt`,
  DROP COLUMN `status`;
```

DOWN 中出现的 `DROP` 只用于撤销本阶段新建对象，且绝不在已有作废业务数据的生产库执行；它不属于本阶段 UP 施工，更不允许拿它删除历史库存单据/流水。

## 5. 权限、接口、页面与报表口径

### 5.1 权限

- 保持 `src/lib/erp-roles.ts` 原样：当前 `canManageInventory` 仅允许 `SUPER_ADMIN` 和 `WAREHOUSE`（`src/lib/erp-roles.ts:39-41`），不改变任何既有页面/API 的权限含义。
- 后续仅在 `src/lib/permissions.ts` 新增独立 `canVoidStockIn(user)`，其角色白名单仍为 `SUPER_ADMIN`、`WAREHOUSE`；不修改既有 `canManageInventory`（现定义见 `src/lib/permissions.ts:198-200`）。
- 服务端另加职责分离：`confirmedById === user.id` 时禁止作废；新入库因创建即确认，创建/确认人不能自己作废。`confirmedById` 为空的历史行不把“未知审核人”冒充为当前用户，但仍需满足所有库存/来源校验。
- `PURCHASE`、`SALES`、`FOREIGN_TRADE` 一律 403；UI 只做隐藏，API 是唯一权威。
- 不触碰 `src/middleware.ts`、角色矩阵或 Agent/MCP 文件。

### 5.2 拟改文件（待计划批准后）

| 文件 | 后续闭环责任 |
| --- | --- |
| `prisma/schema.prisma` | 仅增加 `StockInStatus`、StockIn 作废字段、`StockInVoid`/`StockInVoidItem` 模型。 |
| `prisma/migrations/<phase5>/migration.sql` | 仅采用第 4 节 UP 增量 SQL；另交付受硬门保护的 down runbook。 |
| `src/lib/permissions.ts` | 仅新增 `canVoidStockIn`，不修改既有函数语义。 |
| `src/app/api/erp/stock-in/[id]/void/route.ts`（新增） | 事务、锁、来源/余额/职责分离校验、反向库存/流水、日志与有限重试。 |
| `src/app/api/erp/stock-in/route.ts` | 新建时显式 `CONFIRMED`；GET 改用真实 `status` 筛选并返回作废摘要。 |
| `src/app/api/erp/stock-in/[id]/route.ts` | 返回状态、作废头/行的只读审计信息。 |
| `src/app/(app)/erp/stock-in/page.tsx` | 将说明性“纠错/作废”替换成原因确认框；新增状态筛选/标识，作废单仍可看/可打印。 |
| `src/app/api/erp/stock-out/route.ts`、`src/lib/production-orders.ts`、`src/app/api/erp/production-orders/[id]/status/route.ts`、`src/app/api/erp/production-order-change-requests/[id]/approve/route.ts` | 所有生产退料汇总仅统计 `status=CONFIRMED`，防止未来作废单被继续当作有效退料。 |
| 新增测试文件 | 覆盖第 6 节，不改 Agent/MCP、middleware、版本号。 |

### 5.3 查询、打印和导出口径

- 默认列表包含 `CONFIRMED` 与 `VOIDED`，不隐藏历史；状态筛选提供“全部 / 已确认 / 已作废”。
- 打印“当前筛选结果”复用第4阶段全量分页打印器；作废单必须打印醒目“已作废”、作废时间、原因、作废人及反向流水/审计号。筛选为“已确认”时不包含作废单。
- 库存台账不重写历史：原入库流水和 `StockInVoid` 的 `STOCK_OUT` 反向流水均保留，按时间顺序展示；任何未来导出必须将两者分别列出，不能把作废单从审计结果中删除。

## 6. 风险与测试清单

| 风险 | 控制与验收 |
| --- | --- |
| 并发作废 | 串行化事务、单头/库存行锁、`uq_stock_in_void_stock_in`、P2002/P2034 最多重试 3 次；两次并发请求只能一成功，且仅一组反向流水。 |
| 后续已消耗库存 | 作废前要求每一物料的当前余额不小于原入库数量；否则 409 且零写入，绝不允许负库存。 |
| 已引用入库单 | 采购来源、生产退料来源在首版一律 409；不把已有 `unlink-purchase` 的删除型分配实现混进本阶段。 |
| 金额/平均价 | 新代码只用 `Prisma.Decimal`；按当前移动平均价冲减并将金额写入新作废行审计，零库存时 `avgPrice=null`。 |
| 迁移误判历史 | 新列默认 `CONFIRMED`，迁移不回填、不重算库存/流水；上线前后对 `erp_inventories`、`erp_stock_movements` 做只读数量/汇总对比。 |
| 导出/打印误导 | 作废单不消失，状态/作废原因/时间明确；打印器仍保持 1000 条上限及明确提示。 |
| 审计缺口 | 在同一事务写 `StockInVoid`、明细、反向流水、`VOID_STOCK_IN` 操作日志和齐套复查队列；失败整体回滚。 |
| 权限越权/自审 | 五角色 API 测试；允许角色也不得作废自己确认的单据。 |

拟新增自动化测试至少包括：

1. 迁移结构为纯增量，历史行默认 `CONFIRMED`，库存和历史 `STOCK_IN` 行数量/数值不变。
2. 新入库仍在创建事务中立即确认为 `CONFIRMED`，并立即更新库存与一条原始入库流水。
3. 普通已确认入库作废后，原单/原流水未变；恰好新增一张作废头、作废行、负数量流水、操作日志和齐套复查。
4. 任一库存不足、来源采购/生产退料、已作废、空原因、自我确认单据均失败且没有部分写入。
5. 两个并发作废请求只产生一次冲减；`SUPER_ADMIN`、`WAREHOUSE` 的允许/职责分离，以及 `PURCHASE`、`SALES`、`FOREIGN_TRADE` 的 403 全覆盖。
6. 列表、详情、状态筛选、打印/导出能区分已确认与已作废，且打印不会静默遗漏作废标识。

## 7. 回滚方案

1. **迁移前或无作废数据**：先执行第 4 节 DOWN 的两个只读前置计数；均为 0 才允许在预发布环境按依赖逆序撤销本阶段新增对象。
2. **代码撤回**：如果 migration 已上线但没有作废事实，先下线作废入口，再回退代码；数据库列/表可保留，旧代码仍会继续创建入库并由默认值保持 `CONFIRMED`，不应为追求“干净”而冒险执行 DOWN。
3. **线上已有作废单**：禁止 DOWN、禁止 SQL 删除/改写原单和原流水。恢复到“作废前库存”只能由经审批的补偿操作完成：在独立 `Serializable` 事务中新增一笔 `STOCK_IN` 补偿流水、恢复库存/平均价、将原 `StockIn` 状态改回 `CONFIRMED` 并保留 `StockInVoid` 审计记录及新的 `ROLLBACK_STOCK_IN_VOID` 操作日志。该补偿入口不在本阶段公开 UI 中；若需要，应作为单独受审查的修复提交，不能手工改库。
4. **备份与演练**：任何未来上线前仍执行数据库备份和从备份恢复演练；本计划阶段不运行 migration、不构建、不部署。

## 8. 后续施工顺序与自检

计划获准后按以下小步闭环提交：

1. schema + 纯增量 migration + migration 安全测试；先复核存量数据默认 `CONFIRMED`。
2. 作废领域事务/API、锁/并发/余额/来源保护与五角色测试。
3. 查询详情、生产汇总过滤、操作日志与库存流水展示测试。
4. 入库页面状态/作废确认框、打印/导出口径与端到端回归测试。

每个闭环一个清晰 commit。最终仅在用户/Claude 后续明确授权时运行：

```text
pnpm install --frozen-lockfile
pnpm exec prisma generate
npx tsc --noEmit
pnpm test
pnpm build
```

当前计划书审查前禁止执行上述构建、自检命令，禁止修改业务代码/schema/migration，禁止合并、构建或部署。
