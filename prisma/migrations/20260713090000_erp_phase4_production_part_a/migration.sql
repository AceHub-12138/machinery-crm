-- CreateTable
CREATE TABLE `erp_production_orders` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `contractId` VARCHAR(191) NULL,
    `contractNoSnapshot` VARCHAR(191) NULL,
    `isStockOrder` BOOLEAN NOT NULL DEFAULT false,
    `sequenceInContract` INTEGER NULL,
    `productId` VARCHAR(191) NOT NULL,
    `productModelSnapshot` VARCHAR(191) NOT NULL,
    `productNameSnapshot` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `bomId` VARCHAR(191) NOT NULL,
    `bomVersionSnapshot` VARCHAR(191) NOT NULL,
    `configuration` JSON NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `plannedDate` DATE NULL,
    `responsibleId` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'ISSUED', 'CHANGE_PENDING', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `supersedesId` VARCHAR(191) NULL,
    `isCurrent` BOOLEAN NOT NULL DEFAULT true,
    `remark` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `erp_production_orders_orderNo_key`(`orderNo`),
    UNIQUE INDEX `erp_production_orders_supersedesId_key`(`supersedesId`),
    INDEX `erp_production_orders_contractId_idx`(`contractId`),
    INDEX `erp_production_orders_productId_idx`(`productId`),
    INDEX `erp_production_orders_warehouseId_idx`(`warehouseId`),
    INDEX `erp_production_orders_status_idx`(`status`),
    INDEX `erp_production_orders_responsibleId_idx`(`responsibleId`),
    INDEX `erp_production_orders_createdById_idx`(`createdById`),
    INDEX `erp_production_orders_createdAt_idx`(`createdAt`),
    INDEX `erp_production_orders_deletedAt_idx`(`deletedAt`),
    INDEX `erp_production_orders_contractId_sequenceInContract_idx`(`contractId`, `sequenceInContract`),
    INDEX `erp_production_orders_isCurrent_idx`(`isCurrent`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_production_order_change_requests` (
    `id` VARCHAR(191) NOT NULL,
    `productionOrderId` VARCHAR(191) NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `approverId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reason` TEXT NOT NULL,
    `approvalRemark` TEXT NULL,
    `proposedDiff` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `erp_production_order_change_requests_productionOrderId_idx`(`productionOrderId`),
    INDEX `erp_production_order_change_requests_requesterId_idx`(`requesterId`),
    INDEX `erp_production_order_change_requests_approverId_idx`(`approverId`),
    INDEX `erp_production_order_change_requests_status_idx`(`status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_production_order_change_requests_productionOrderId_fkey` FOREIGN KEY (`productionOrderId`) REFERENCES `erp_production_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Existing ERP stock records remain untouched. These nullable fields only link new
-- production material issue/return documents back to a production order.
ALTER TABLE `erp_stock_ins` ADD COLUMN `productionOrderId` VARCHAR(191) NULL;
CREATE INDEX `erp_stock_ins_productionOrderId_idx` ON `erp_stock_ins`(`productionOrderId`);

ALTER TABLE `erp_stock_outs` ADD COLUMN `productionOrderId` VARCHAR(191) NULL;
CREATE INDEX `erp_stock_outs_productionOrderId_idx` ON `erp_stock_outs`(`productionOrderId`);

-- CreateTable
CREATE TABLE `erp_production_order_materials` (
    `id` VARCHAR(191) NOT NULL,
    `productionOrderId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `materialCodeSnapshot` VARCHAR(191) NOT NULL,
    `materialNameSnapshot` VARCHAR(191) NOT NULL,
    `materialSpecSnapshot` VARCHAR(191) NULL,
    `unitSnapshot` VARCHAR(191) NOT NULL,
    `perUnitQuantity` DECIMAL(10, 4) NOT NULL,
    `requiredQuantity` DECIMAL(12, 4) NOT NULL,
    `bomVersionSnapshot` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_production_order_materials_productionOrderId_idx`(`productionOrderId`),
    INDEX `erp_production_order_materials_materialId_idx`(`materialId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_production_order_materials_productionOrderId_fkey` FOREIGN KEY (`productionOrderId`) REFERENCES `erp_production_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_kit_check_results` (
    `id` VARCHAR(191) NOT NULL,
    `productionOrderId` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `status` ENUM('NOT_CHECKED', 'SUFFICIENT', 'SHORTAGE') NOT NULL,
    `shortageCount` INTEGER NOT NULL DEFAULT 0,
    `totalMaterials` INTEGER NOT NULL DEFAULT 0,
    `detail` JSON NOT NULL,
    `checkedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_kit_check_results_productionOrderId_idx`(`productionOrderId`),
    INDEX `erp_kit_check_results_warehouseId_idx`(`warehouseId`),
    INDEX `erp_kit_check_results_status_idx`(`status`),
    INDEX `erp_kit_check_results_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_kit_check_results_productionOrderId_fkey` FOREIGN KEY (`productionOrderId`) REFERENCES `erp_production_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
