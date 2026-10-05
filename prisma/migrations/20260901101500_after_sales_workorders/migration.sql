-- 纯新增售后调试模块：不修改既有 CRM/ERP 表及历史数据。
CREATE TABLE `after_sales_orders` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `contractId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `contractNoSnapshot` VARCHAR(191) NOT NULL,
    `customerNameSnapshot` VARCHAR(191) NOT NULL,
    `equipmentModelSnapshot` VARCHAR(191) NOT NULL,
    `orderType` VARCHAR(191) NOT NULL,
    `urgency` VARCHAR(191) NOT NULL DEFAULT 'NORMAL',
    `dispatchDate` DATE NOT NULL,
    `completedDate` DATE NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_DISPATCH',
    `serviceAmount` DECIMAL(12, 2) NULL,
    `assigneeNames` TEXT NOT NULL,
    `description` TEXT NOT NULL,
    `receiptContent` TEXT NULL,
    `problemCategory` VARCHAR(191) NULL,
    `otherReason` TEXT NULL,
    `receiptAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `after_sales_orders_orderNo_key`(`orderNo`),
    INDEX `after_sales_orders_contractId_idx`(`contractId`),
    INDEX `after_sales_orders_customerId_idx`(`customerId`),
    INDEX `after_sales_orders_status_idx`(`status`),
    INDEX `after_sales_orders_dispatchDate_idx`(`dispatchDate`),
    INDEX `after_sales_orders_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `after_sales_orders_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `after_sales_orders_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `after_sales_orders_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `after_sales_order_parts` (
    `id` VARCHAR(191) NOT NULL,
    `afterSalesOrderId` VARCHAR(191) NOT NULL,
    `partName` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `after_sales_order_parts_afterSalesOrderId_idx`(`afterSalesOrderId`),
    INDEX `after_sales_order_parts_partName_idx`(`partName`),
    PRIMARY KEY (`id`),
    CONSTRAINT `after_sales_order_parts_afterSalesOrderId_fkey` FOREIGN KEY (`afterSalesOrderId`) REFERENCES `after_sales_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `after_sales_supplement_parts` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `after_sales_supplement_parts_name_key`(`name`),
    PRIMARY KEY (`id`),
    CONSTRAINT `after_sales_supplement_parts_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
