# ERP 驾驶舱指标口径（阶段 1）

审计基线：`adfc3bd`。所有指标只使用现有 Prisma 枚举和模型；没有可靠历史快照时不返回同比/环比。各查询先由 `modules/erp/dashboard/permissions.ts` 按角色决定可查 section 与字段，再执行数据查询。

| 指标 | 业务定义与真实状态 | 数据来源/时间口径 | 允许角色与返回字段 | 点击目标/空值 |
| --- | --- | --- | --- | --- |
| 进行中工单 | `ProductionOrder.status = ISSUED` 且 `deletedAt IS NULL` | `erp_production_orders`；当前快照 | 全部 ERP 角色；工单号、产品、计划日、齐套状态 | 角色对应工单列表；0 显示暂无数据 |
| 即将逾期工单 | `ISSUED`，计划日期在未来 7 天内 | 工单 `plannedDate`；当前日 | 全部 ERP 角色；不返回客户/合同金额 | 对应角色工单列表；0 |
| 已经逾期工单 | `ISSUED` 且计划日期早于当前日 | 同上 | 全部 ERP 角色；同上 | 对应列表；0 |
| 待齐套工单 | `kitCheckStatus = NOT_CHECKED` 或 `kitCheckRequired = true` | 工单当前快照 | 全部 ERP 角色 | 齐套/工单列表；0 |
| 完全齐套工单 | `kitCheckStatus = SUFFICIENT` | 当前工单快照 | 全部 ERP 角色 | 齐套结果；0 |
| 齐套率 | `SUFFICIENT ÷ 已纳入统计的未删除工单 × 100%` | 工单当前快照；分母为非取消、未删除工单 | 全部 ERP 角色 | 齐套结果；分母为 0 显示暂无数据 |
| 缺料影响工单 | `kitCheckStatus = SHORTAGE` | 工单/最新齐套结果 | 全部 ERP 角色；工单号、型号、缺料项数 | 齐套/采购/备料列表；0 |
| 缺料排行榜 | 取最新齐套 detail 中的短缺物料按短缺量/影响工单数排名 | `KitCheckResult.detail`；只读聚合，无法可靠解析则不展示 | 全部 ERP 角色；物料、缺口、影响工单、可用库存、已采购未到 | 齐套或采购需求；无可靠数据为暂无数据 |
| 库存报警 | 当前库存小于等于物料安全库存/分类预警阈值 | `Inventory` + `Material`/`MaterialCategory`；实时 | 超管/仓库完整；采购只读物料、库存、安全库存 | 库存台账；0 |
| 待采购物料 | 活动采购需求状态为 `DRAFT`、`SUBMITTED`、`APPROVED` 或 `PARTIALLY_CONVERTED` | `PurchaseDemand`；当前快照 | 超管/采购完整，仓库仅必要收货关联摘要 | 采购需求；0 |
| 延期采购订单 | 采购明细 `deliveryStatus` 为 `OVERDUE_NOT_RECEIVED` 或 `OVERDUE_PARTIAL_RECEIVED` | `PurchaseOrderItem` + 未删订单 | 超管/采购完整；仓库仅订单、供应商、物料、到货日期、待收数量 | 供应商交期；0 |
| 供应商交期风险 | 明细延期或最新承诺日影响生产 | `PurchaseOrderItem.latestPromisedDate`、交期状态/历史 | 超管/采购完整；仓库不返回采购价格 | 供应商交期；无风险为暂无数据 |
| 呆滞库存 | 90 天无库存流水的现有物料 | `Inventory` + `StockMovement.createdAt` | 超管/仓库完整；采购仅只读库存摘要 | 库存台账；0 |
| 待入库 | 未删采购订单的 `ORDERED`/`PARTIAL_RECEIVED` 明细存在待收数量 | `PurchaseOrderItem.quantity - receivedQuantity` | 超管/仓库完整；采购可看采购范围 | 入库或采购收货列表；0 |
| 待出库 | 当前没有独立待出库状态/队列表 | 无真实单据状态可用 | 超管/仓库 | 不伪造指标，显示“统计数据不足” |
| 待盘点 | `StockCheck.status = DRAFT` 或 `CHECKING` | `StockCheck`；当前快照 | 超管/仓库 | 盘点列表；0 |
| 待调拨 | 当前 `StockTransfer` 创建即确认，没有待处理状态 | 无真实待调拨状态可用 | 超管/仓库 | 不伪造指标，显示“统计数据不足” |
