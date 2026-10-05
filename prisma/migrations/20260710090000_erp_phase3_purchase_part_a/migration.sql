SET FOREIGN_KEY_CHECKS=0;

-- CreateTable
CREATE TABLE `erp_suppliers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `wechat` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `mainCategory` VARCHAR(191) NULL,
    `remark` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `erp_suppliers_isActive_idx`(`isActive`),
    INDEX `erp_suppliers_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_purchase_orders` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `supplierNameSnapshot` VARCHAR(191) NOT NULL,
    `orderDate` DATETIME(3) NOT NULL,
    `expectedArrivalDate` DATETIME(3) NULL,
    `status` ENUM('DRAFT', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `remark` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `erp_purchase_orders_orderNo_key`(`orderNo`),
    INDEX `erp_purchase_orders_supplierId_idx`(`supplierId`),
    INDEX `erp_purchase_orders_status_idx`(`status`),
    INDEX `erp_purchase_orders_createdById_idx`(`createdById`),
    INDEX `erp_purchase_orders_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_purchase_order_items` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `materialCodeSnapshot` VARCHAR(191) NOT NULL,
    `materialNameSnapshot` VARCHAR(191) NOT NULL,
    `materialSpecSnapshot` VARCHAR(191) NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `receivedQuantity` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_purchase_order_items_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `erp_purchase_order_items_materialId_idx`(`materialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `erp_materials` ADD COLUMN `supplierId` VARCHAR(191) NULL;
CREATE INDEX `erp_materials_supplierId_idx` ON `erp_materials`(`supplierId`);

SET FOREIGN_KEY_CHECKS=1;
