# DachuanPro v2.0 数据库变更设计（阶段 0）

## 1. 已有结构与约束

- 数据库是 MySQL（Prisma datasource）；目标必须兼容 MySQL 5.7.36。
- 已有五个角色：`SUPER_ADMIN`、`SALES`、`FOREIGN_TRADE`、`PURCHASE`、`WAREHOUSE`；本次不新增角色。
- ERP 已有 `PurchaseOrder.deletedAt`、`ProductionOrder.deletedAt`、库存/采购/生产/齐套/交期/附件等模型；金额、库存数量和采购数量已广泛使用 `Decimal`。
- `StockIn.batchNo`、`StockOut.batchNo`、`StockCheck.batchNo`、`StockTransfer.transferNo`、`PurchaseOrder.orderNo`、`ProductionOrder.orderNo` 都已有唯一约束。现有编号由代码生成，尚无统一编号规则表。具体盘点：入库为 `INyyyyMMdd`+4 位随机字符、出库为 `OUTyyyyMMdd`+4 位随机字符、盘点为 `CKyyyyMMdd`+4 位随机字符、调拨为 `TRyyyyMMdd`+6 位 UUID、采购为 `POyyyyMMdd`+5 位随机字符、采购需求为 `PR-yyyyMMdd-`+8 位 UUID；生产草稿先为 `DRAFT-`+8 位 UUID，备货工单使用 `STK-yyyyMMdd-` 顺序号并在 Serializable 事务中有限重试，合同来源已下达工单使用合同号-序号。当前随机规则由数据库唯一约束兜底，除生产工单外不能证明有序号并发重试。
- `StockIn` 目前没有状态、作废字段或反向流水关联；`StockMovement` 目前没有 `reverseOfId`；`KitCheckResult` 目前没有 `deletedAt`。

## 2. 允许的新增设计（按阶段实施，不在本阶段落库）

| 阶段 | 追加项 | 用途与约束 |
| --- | --- | --- |
| 3 | `system_user_task_states`（建议） | 仅保存 userId、sourceType/sourceId、readAt、pinnedAt、ignoredAt、lastViewedAt；不复制业务审批状态 |
| 3 | `system_permission_definitions`、`system_role_permissions`（待 API/权限审计确认） | 代码定义为准；仅保存被允许的角色-动作映射。必须有 `SUPER_ADMIN` 全权限硬兜底 |
| 3 | `system_settings`（白名单键） | 提醒、打印企业信息等非密钥配置；不得存连接串、密码、Cookie、Token、API Key、私钥或 Shell 配置 |
| 3 | `KitCheckResult.deletedAt`、`deletedById`（可空外键）、`deleteReason` | 软删除齐套结果；默认查询过滤；不反向库存、不级联删除采购需求 |
| 3 | 采购删除申请表（建议 `erp_purchase_order_delete_requests`） | 记录订单、申请人、原因、审批人、状态和时间；不把审批状态塞入订单主状态 |
| 4 | `system_number_rules` 与 `system_number_counters` | 规则仅允许白名单字段；计数器以 `documentType + dateKey` 唯一，事务/行锁分配每日顺序号，数据库唯一约束和有限重试兜底 |
| 5 | `StockIn.status`、`voidedAt`、`voidReason`、`voidedById`、`voidMovementId` | 默认历史数据 `ACTIVE`；只允许超级管理员作废，字段均为追加 |
| 5 | `StockMovement.reverseOfId`（可空）及唯一/索引 | 反向流水不可替代原流水；应能防止同一正向流水重复反冲 |
| 5 | 必要索引 | 对作废预览、引用检查与 `reverseOfId` 访问增加短名称索引；所有名称少于 64 字符 |

## 3. 入库作废的事务性设计

阶段 5 独立实现，且先提供只读影响预览。真正作废必须在 Serializable 事务中：锁定 ACTIVE 入库单及其库存行 → 检查不可逆后续引用与反冲后库存非负 → 建立反向 `StockMovement`（Decimal）→ 回退采购收货数量/状态及其分摊（若为采购入库）→ 标为 VOIDED 并写 `voidMovementId` → 写完整脱敏操作日志。并发作废同一单只能一次成功；冲突/后续引用/库存不足必须返回 409。

禁止修改既有库存流水、硬删入库、批量删除采购来源或以页面按钮绕过事务。

## 4. 编号策略

- 手动：生产工单、入库、出库。后端 `trim`、必填、全局唯一；状态/引用后禁止任意改号并写审计。
- 自动：采购订单 `PO-yyyyMMdd-NNN`、盘点 `SC-yyyyMMdd-NNN`、调拨 `TR-yyyyMMdd-NNN`。每日 `001` 起、超过 999 自然扩展；阶段 4 用 `system_number_rules` 与 `system_number_counters(documentType,dateKey)` 的唯一键、事务/行锁、唯一约束和有限重试实现，禁止无锁查询最大值加一。
- 合同、发货及其余编号不在 2.0 改动范围。

## 5. SQL 与交付规则

每一个实际实施阶段单独增加 `deploy/v2.0/sql/NNN_*.sql`，只含 `CREATE TABLE`、`ADD COLUMN`、`ADD INDEX`、可空外键与安全枚举追加；不可包含 `DROP`、`TRUNCATE`、批量 `DELETE` 或历史流水改写。同步更新 `PREFLIGHT.md`、`DEPLOY.md`、`ROLLBACK.md`、`ACCEPTANCE.md`，供 phpMyAdmin 手工导入；不依赖生产运行 `prisma migrate deploy`，也不连接线上数据库。

## 6. 选配项与齐套的审计结论

现有合同明细已区分 `ContractItemType.MAIN/OPTIONAL`，产品也有 `ProductType.MAIN/OPTIONAL`；生产工单有 `configuration Json?`，BOM 是按主产品版本保存，齐套结果 `detail Json` 但没有“是否包含选配项”字段。当前源码不能证明选配产品已关联 BOM 或形成可追溯数量口径。因此本次不把选配项自动计入齐套，也不修改数据库。后续单独确认主/选配 BOM 合并、数量、采购需求和历史兼容后，才新增必要的快照字段；在此之前齐套 UI 必须明确“本次齐套检查未包含非结构化选配备注”。
