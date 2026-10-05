-- ERP Phase 4 procurement, planning, stock audit and supplier delivery controls.
-- Additive migration only; no existing business rows are deleted.

ALTER TABLE `contract_items`
  ADD COLUMN `estimatedShipmentDate` DATE NULL;
CREATE INDEX `idx_contract_item_delivery` ON `contract_items`(`estimatedShipmentDate`);

ALTER TABLE `erp_materials`
  ADD COLUMN `minStock` DECIMAL(10,2) NULL,
  ADD COLUMN `maxStock` DECIMAL(10,2) NULL,
  ADD COLUMN `procurementLeadDays` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `safetyStockEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `autoPurchaseDraftEnabled` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `erp_bom_headers`
  ADD COLUMN `supersedesId` VARCHAR(191) NULL;
CREATE INDEX `idx_bom_supersedes` ON `erp_bom_headers`(`supersedesId`);

ALTER TABLE `erp_production_orders`
  ADD COLUMN `deliveryDateSnapshot` DATE NULL,
  ADD COLUMN `kitCheckStatus` ENUM('NOT_CHECKED','SUFFICIENT','SHORTAGE') NOT NULL DEFAULT 'NOT_CHECKED',
  ADD COLUMN `kitCheckRequired` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `latestKitCheckId` VARCHAR(191) NULL,
  ADD COLUMN `lastKitCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `monthlyPlanItemId` VARCHAR(191) NULL;
CREATE INDEX `idx_po_kit_required` ON `erp_production_orders`(`kitCheckRequired`);
CREATE INDEX `idx_po_month_plan_item` ON `erp_production_orders`(`monthlyPlanItemId`);

ALTER TABLE `erp_kit_check_results`
  ADD COLUMN `triggerKey` VARCHAR(191) NULL,
  ADD COLUMN `triggerType` VARCHAR(32) NOT NULL DEFAULT 'MANUAL';
CREATE UNIQUE INDEX `uq_kit_check_trigger` ON `erp_kit_check_results`(`triggerKey`);

ALTER TABLE `erp_stock_ins`
  ADD COLUMN `confirmedById` VARCHAR(191) NULL,
  ADD COLUMN `confirmedAt` DATETIME(3) NULL,
  ADD COLUMN `sourceDocumentSnapshot` JSON NULL;
ALTER TABLE `erp_stock_in_items`
  ADD COLUMN `materialCodeSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `materialNameSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `materialSpecSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `unitSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `warehouseSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `beforeQty` DECIMAL(10,2) NULL,
  ADD COLUMN `afterQty` DECIMAL(10,2) NULL;

ALTER TABLE `erp_stock_outs`
  ADD COLUMN `confirmedById` VARCHAR(191) NULL,
  ADD COLUMN `confirmedAt` DATETIME(3) NULL,
  ADD COLUMN `sourceDocumentSnapshot` JSON NULL;
ALTER TABLE `erp_stock_out_items`
  ADD COLUMN `materialCodeSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `materialNameSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `materialSpecSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `unitSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `warehouseSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `beforeQty` DECIMAL(10,2) NULL,
  ADD COLUMN `afterQty` DECIMAL(10,2) NULL;

ALTER TABLE `erp_purchase_order_items`
  ADD COLUMN `needArrivalDate` DATE NULL,
  ADD COLUMN `requiredDeliveryDate` DATE NULL,
  ADD COLUMN `firstPromisedDate` DATE NULL,
  ADD COLUMN `latestPromisedDate` DATE NULL,
  ADD COLUMN `estimatedShipDate` DATE NULL,
  ADD COLUMN `actualShipDate` DATE NULL,
  ADD COLUMN `actualArrivalDate` DATE NULL,
  ADD COLUMN `deliveryStatus` ENUM('NOT_DELIVERED','PARTIAL_RECEIVED','FULLY_RECEIVED','OVERDUE_NOT_RECEIVED','OVERDUE_PARTIAL_RECEIVED','CLOSED') NOT NULL DEFAULT 'NOT_DELIVERED',
  ADD COLUMN `responsibleId` VARCHAR(191) NULL;
CREATE INDEX `idx_po_item_responsible` ON `erp_purchase_order_items`(`responsibleId`);
CREATE INDEX `idx_po_item_delivery_status` ON `erp_purchase_order_items`(`deliveryStatus`);
CREATE INDEX `idx_po_item_latest_promise` ON `erp_purchase_order_items`(`latestPromisedDate`);

ALTER TABLE `erp_stock_movements`
  MODIFY `type` ENUM('STOCK_IN','STOCK_OUT','CHECK_ADJUST','TRANSFER_IN','TRANSFER_OUT') NOT NULL;

CREATE TABLE `erp_monthly_production_plans` (
  `id` VARCHAR(191) NOT NULL,
  `planNo` VARCHAR(191) NOT NULL,
  `planMonth` DATE NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `status` ENUM('DRAFT','PENDING_APPROVAL','APPROVED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `description` TEXT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `supersedesId` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `approvedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approvedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_month_plan_no`(`planNo`),
  UNIQUE INDEX `uq_month_plan_month_ver`(`planMonth`,`version`),
  INDEX `idx_month_plan_status`(`status`),
  INDEX `idx_month_plan_supersedes`(`supersedesId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_monthly_production_plan_items` (
  `id` VARCHAR(191) NOT NULL,
  `planId` VARCHAR(191) NOT NULL,
  `productId` VARCHAR(191) NOT NULL,
  `productModelSnapshot` VARCHAR(191) NOT NULL,
  `plannedQuantity` DECIMAL(10,2) NOT NULL,
  `plannedStartDate` DATE NOT NULL,
  `plannedCompletionDate` DATE NOT NULL,
  `bomId` VARCHAR(191) NOT NULL,
  `bomVersionSnapshot` VARCHAR(191) NOT NULL,
  `convertedQuantity` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `remark` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_month_item_plan`(`planId`),
  INDEX `idx_month_item_product`(`productId`),
  CONSTRAINT `fk_month_item_plan` FOREIGN KEY (`planId`) REFERENCES `erp_monthly_production_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `erp_production_orders`
  ADD CONSTRAINT `fk_po_month_plan_item` FOREIGN KEY (`monthlyPlanItemId`) REFERENCES `erp_monthly_production_plan_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `erp_monthly_material_requirements` (
  `id` VARCHAR(191) NOT NULL,
  `planItemId` VARCHAR(191) NOT NULL,
  `materialId` VARCHAR(191) NOT NULL,
  `requiredQuantity` DECIMAL(12,4) NOT NULL,
  `plannedDemandQty` DECIMAL(12,4) NOT NULL,
  `convertedDemandQty` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `calculationSnapshot` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_month_req_item_mat`(`planItemId`,`materialId`),
  INDEX `idx_month_req_material`(`materialId`),
  CONSTRAINT `fk_month_req_item` FOREIGN KEY (`planItemId`) REFERENCES `erp_monthly_production_plan_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_month_req_material` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_purchase_demands` (
  `id` VARCHAR(191) NOT NULL,
  `demandNo` VARCHAR(191) NOT NULL,
  `sourceType` ENUM('PRODUCTION_ORDER','STOCK_REPLENISHMENT','MONTHLY_PRODUCTION_PLAN','MANUAL') NOT NULL,
  `sourceRecordId` VARCHAR(191) NOT NULL,
  `sourceLineId` VARCHAR(191) NULL,
  `sourceLabel` VARCHAR(191) NOT NULL,
  `materialId` VARCHAR(191) NOT NULL,
  `requestedQuantity` DECIMAL(12,4) NOT NULL,
  `suggestedQuantity` DECIMAL(12,4) NOT NULL,
  `convertedQuantity` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `targetStockQuantity` DECIMAL(12,4) NULL,
  `needByDate` DATE NOT NULL,
  `stockPurpose` VARCHAR(191) NULL,
  `replenishmentReason` VARCHAR(191) NULL,
  `calculationSnapshot` JSON NOT NULL,
  `status` ENUM('DRAFT','SUBMITTED','APPROVED','PARTIALLY_CONVERTED','CONVERTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `activeSlot` BOOLEAN NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `approvedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approvedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_purchase_demand_no`(`demandNo`),
  UNIQUE INDEX `erp_demand_source_mat_active_uq`(`sourceType`,`sourceRecordId`,`materialId`,`activeSlot`),
  INDEX `idx_demand_material_status`(`materialId`,`status`),
  INDEX `idx_demand_source`(`sourceType`,`sourceRecordId`),
  INDEX `idx_demand_need_date`(`needByDate`),
  CONSTRAINT `fk_demand_material` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_purchase_order_item_sources` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderItemId` VARCHAR(191) NOT NULL,
  `purchaseDemandId` VARCHAR(191) NOT NULL,
  `allocatedQuantity` DECIMAL(12,4) NOT NULL,
  `fulfilledQuantity` DECIMAL(12,4) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `erp_po_item_demand_uq`(`purchaseOrderItemId`,`purchaseDemandId`),
  INDEX `idx_po_source_demand`(`purchaseDemandId`),
  CONSTRAINT `fk_po_source_item` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `erp_purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_po_source_demand` FOREIGN KEY (`purchaseDemandId`) REFERENCES `erp_purchase_demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_kit_recheck_queue` (
  `id` VARCHAR(191) NOT NULL,
  `productionOrderId` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(191) NOT NULL,
  `materialIds` JSON NOT NULL,
  `requestedById` VARCHAR(191) NOT NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processingAt` DATETIME(3) NULL,
  `processedAt` DATETIME(3) NULL,
  `attemptCount` INTEGER NOT NULL DEFAULT 0,
  `lastError` TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_kit_queue_order`(`productionOrderId`),
  INDEX `idx_kit_queue_pending`(`processedAt`,`requestedAt`),
  CONSTRAINT `fk_kit_queue_order` FOREIGN KEY (`productionOrderId`) REFERENCES `erp_production_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_supplier_delivery_followups` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderItemId` VARCHAR(191) NOT NULL,
  `followedAt` DATETIME(3) NOT NULL,
  `followedById` VARCHAR(191) NOT NULL,
  `supplierContact` VARCHAR(191) NULL,
  `contactMethod` VARCHAR(191) NULL,
  `progress` ENUM('UNCONFIRMED','NOT_SCHEDULED','SCHEDULED','IN_PRODUCTION','PENDING_INSPECTION','COMPLETED','PENDING_SHIPMENT','SHIPPED','PARTIAL_RECEIVED','FULLY_RECEIVED','DELAYED','PAUSED') NOT NULL,
  `completionPercent` INTEGER NULL,
  `estimatedCompletionDate` DATE NULL,
  `estimatedShipDate` DATE NULL,
  `hasDelayRisk` BOOLEAN NOT NULL DEFAULT false,
  `riskReason` TEXT NULL,
  `actionPlan` TEXT NULL,
  `remark` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_followup_item_time`(`purchaseOrderItemId`,`followedAt`),
  CONSTRAINT `fk_followup_po_item` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `erp_purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_supplier_promise_date_history` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderItemId` VARCHAR(191) NOT NULL,
  `oldPromisedDate` DATE NULL,
  `newPromisedDate` DATE NOT NULL,
  `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `changedById` VARCHAR(191) NOT NULL,
  `supplierReason` TEXT NULL,
  `affectsProduction` BOOLEAN NOT NULL DEFAULT false,
  `remark` TEXT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_promise_item_time`(`purchaseOrderItemId`,`changedAt`),
  CONSTRAINT `fk_promise_po_item` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `erp_purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_purchase_delivery_batches` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderItemId` VARCHAR(191) NOT NULL,
  `plannedQuantity` DECIMAL(10,2) NOT NULL,
  `plannedArrivalDate` DATE NULL,
  `promisedDate` DATE NULL,
  `shippedQuantity` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `actualShipDate` DATE NULL,
  `receivedQuantity` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `actualArrivalDate` DATE NULL,
  `trackingNo` VARCHAR(191) NULL,
  `remark` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_delivery_batch_item`(`purchaseOrderItemId`),
  CONSTRAINT `fk_delivery_batch_item` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `erp_purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_purchase_demand_production_allocations` (
  `id` VARCHAR(191) NOT NULL, `purchaseDemandId` VARCHAR(191) NOT NULL,
  `productionOrderId` VARCHAR(191) NOT NULL, `purchaseOrderItemId` VARCHAR(191) NULL,
  `allocatedQuantity` DECIMAL(12,4) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `erp_demand_prod_order_uq`(`purchaseDemandId`,`productionOrderId`),
  INDEX `idx_demand_prod_order`(`productionOrderId`), INDEX `idx_demand_prod_po_item`(`purchaseOrderItemId`),
  CONSTRAINT `fk_demand_prod_demand` FOREIGN KEY (`purchaseDemandId`) REFERENCES `erp_purchase_demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_demand_prod_order` FOREIGN KEY (`productionOrderId`) REFERENCES `erp_production_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_demand_prod_po_item` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `erp_purchase_order_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_purchase_delivery_receipt_allocations` (
  `id` VARCHAR(191) NOT NULL, `deliveryBatchId` VARCHAR(191) NOT NULL,
  `stockInItemId` VARCHAR(191) NOT NULL, `quantity` DECIMAL(10,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `erp_batch_receipt_item_uq`(`deliveryBatchId`,`stockInItemId`),
  INDEX `idx_batch_receipt_stock_item`(`stockInItemId`),
  CONSTRAINT `fk_batch_receipt_batch` FOREIGN KEY (`deliveryBatchId`) REFERENCES `erp_purchase_delivery_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_batch_receipt_stock_item` FOREIGN KEY (`stockInItemId`) REFERENCES `erp_stock_in_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_stock_transfers` (
  `id` VARCHAR(191) NOT NULL, `transferNo` VARCHAR(191) NOT NULL,
  `fromWarehouseId` VARCHAR(191) NOT NULL, `toWarehouseId` VARCHAR(191) NOT NULL,
  `reason` TEXT NULL, `confirmedById` VARCHAR(191) NOT NULL,
  `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_stock_transfer_no`(`transferNo`),
  INDEX `idx_transfer_from_wh`(`fromWarehouseId`), INDEX `idx_transfer_to_wh`(`toWarehouseId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_stock_transfer_items` (
  `id` VARCHAR(191) NOT NULL, `stockTransferId` VARCHAR(191) NOT NULL,
  `materialId` VARCHAR(191) NOT NULL, `materialCodeSnapshot` VARCHAR(191) NOT NULL,
  `materialNameSnapshot` VARCHAR(191) NOT NULL, `materialSpecSnapshot` VARCHAR(191) NULL,
  `unitSnapshot` VARCHAR(191) NOT NULL, `quantity` DECIMAL(10,2) NOT NULL,
  `fromBeforeQty` DECIMAL(10,2) NOT NULL, `fromAfterQty` DECIMAL(10,2) NOT NULL,
  `toBeforeQty` DECIMAL(10,2) NOT NULL, `toAfterQty` DECIMAL(10,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
  INDEX `idx_transfer_item_header`(`stockTransferId`), INDEX `idx_transfer_item_material`(`materialId`),
  CONSTRAINT `fk_transfer_item_header` FOREIGN KEY (`stockTransferId`) REFERENCES `erp_stock_transfers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_attachments` (
  `id` VARCHAR(191) NOT NULL,
  `entityType` VARCHAR(64) NOT NULL,
  `entityId` VARCHAR(191) NOT NULL,
  `fileName` VARCHAR(255) NOT NULL,
  `storedName` VARCHAR(255) NOT NULL,
  `fileUrl` VARCHAR(512) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `fileSize` INTEGER NOT NULL,
  `uploadedById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deletedAt` DATETIME(3) NULL,
  `deletedById` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_attachment_entity`(`entityType`,`entityId`,`deletedAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_procurement_config` (
  `id` VARCHAR(191) NOT NULL DEFAULT 'default',
  `attentionDays` INTEGER NOT NULL DEFAULT 7,
  `highRiskDays` INTEGER NOT NULL DEFAULT 3,
  `urgentDays` INTEGER NOT NULL DEFAULT 1,
  `updatedById` VARCHAR(191) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `erp_procurement_config` (`id`,`attentionDays`,`highRiskDays`,`urgentDays`,`updatedAt`)
VALUES ('default',7,3,1,CURRENT_TIMESTAMP(3));

CREATE TABLE `erp_notifications` (
  `id` VARCHAR(191) NOT NULL,
  `notificationKey` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `link` VARCHAR(512) NULL,
  `level` VARCHAR(32) NOT NULL DEFAULT 'INFO',
  `readAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_erp_notification_key`(`notificationKey`),
  INDEX `idx_erp_notification_user`(`userId`,`readAt`,`createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
