-- AlterTable
ALTER TABLE `users` MODIFY `role` ENUM('SUPER_ADMIN', 'SALES', 'FOREIGN_TRADE', 'WAREHOUSE') NOT NULL;

-- CreateTable
CREATE TABLE `erp_warehouses` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `erp_warehouses_code_key`(`code`),
    INDEX `erp_warehouses_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_material_categories` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_material_categories_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_material_categories_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `erp_material_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_materials` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NOT NULL,
    `spec` VARCHAR(191) NULL,
    `materialType` VARCHAR(191) NULL,
    `drawingNo` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT '件',
    `standardPrice` DECIMAL(12, 2) NULL,
    `safetyStock` DECIMAL(10, 2) NULL,
    `weight` DECIMAL(10, 2) NULL,
    `remark` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `erp_materials_code_key`(`code`),
    INDEX `erp_materials_categoryId_idx`(`categoryId`),
    INDEX `erp_materials_isActive_idx`(`isActive`),
    INDEX `erp_materials_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_materials_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `erp_material_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_inventories` (
    `id` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `avgPrice` DECIMAL(12, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `erp_inventories_materialId_idx`(`materialId`),
    UNIQUE INDEX `erp_inventories_warehouseId_materialId_key`(`warehouseId`, `materialId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_inventories_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `erp_warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `erp_inventories_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_ins` (
    `id` VARCHAR(191) NOT NULL,
    `batchNo` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `type` ENUM('PURCHASE', 'RETURN', 'INITIAL', 'CHECK_IN', 'OTHER') NOT NULL DEFAULT 'PURCHASE',
    `remark` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `erp_stock_ins_batchNo_key`(`batchNo`),
    INDEX `erp_stock_ins_warehouseId_idx`(`warehouseId`),
    INDEX `erp_stock_ins_type_idx`(`type`),
    INDEX `erp_stock_ins_createdById_idx`(`createdById`),
    INDEX `erp_stock_ins_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_stock_ins_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `erp_warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_in_items` (
    `id` VARCHAR(191) NOT NULL,
    `stockInId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_stock_in_items_stockInId_idx`(`stockInId`),
    INDEX `erp_stock_in_items_materialId_idx`(`materialId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_stock_in_items_stockInId_fkey` FOREIGN KEY (`stockInId`) REFERENCES `erp_stock_ins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `erp_stock_in_items_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_outs` (
    `id` VARCHAR(191) NOT NULL,
    `batchNo` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `type` ENUM('PRODUCTION', 'CHECK_OUT', 'OTHER') NOT NULL DEFAULT 'PRODUCTION',
    `remark` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `erp_stock_outs_batchNo_key`(`batchNo`),
    INDEX `erp_stock_outs_warehouseId_idx`(`warehouseId`),
    INDEX `erp_stock_outs_type_idx`(`type`),
    INDEX `erp_stock_outs_createdById_idx`(`createdById`),
    INDEX `erp_stock_outs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_stock_outs_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `erp_warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_out_items` (
    `id` VARCHAR(191) NOT NULL,
    `stockOutId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_stock_out_items_stockOutId_idx`(`stockOutId`),
    INDEX `erp_stock_out_items_materialId_idx`(`materialId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_stock_out_items_stockOutId_fkey` FOREIGN KEY (`stockOutId`) REFERENCES `erp_stock_outs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `erp_stock_out_items_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_checks` (
    `id` VARCHAR(191) NOT NULL,
    `batchNo` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `checkDate` DATETIME(3) NOT NULL,
    `status` ENUM('DRAFT', 'CHECKING', 'DONE') NOT NULL DEFAULT 'DRAFT',
    `remark` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `erp_stock_checks_batchNo_key`(`batchNo`),
    INDEX `erp_stock_checks_warehouseId_idx`(`warehouseId`),
    INDEX `erp_stock_checks_status_idx`(`status`),
    INDEX `erp_stock_checks_checkDate_idx`(`checkDate`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_stock_checks_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `erp_warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_check_items` (
    `id` VARCHAR(191) NOT NULL,
    `stockCheckId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `bookQty` DECIMAL(10, 2) NOT NULL,
    `actualQty` DECIMAL(10, 2) NULL,
    `diffQty` DECIMAL(10, 2) NULL,
    `diffAmount` DECIMAL(12, 2) NULL,
    `reason` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_stock_check_items_stockCheckId_idx`(`stockCheckId`),
    INDEX `erp_stock_check_items_materialId_idx`(`materialId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_stock_check_items_stockCheckId_fkey` FOREIGN KEY (`stockCheckId`) REFERENCES `erp_stock_checks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `erp_stock_check_items_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_stock_movements` (
    `id` VARCHAR(191) NOT NULL,
    `warehouseId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `type` ENUM('STOCK_IN', 'STOCK_OUT', 'CHECK_ADJUST') NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `beforeQty` DECIMAL(10, 2) NOT NULL,
    `afterQty` DECIMAL(10, 2) NOT NULL,
    `refType` VARCHAR(191) NOT NULL,
    `refId` VARCHAR(191) NOT NULL,
    `remark` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_stock_movements_warehouseId_idx`(`warehouseId`),
    INDEX `erp_stock_movements_materialId_idx`(`materialId`),
    INDEX `erp_stock_movements_type_idx`(`type`),
    INDEX `erp_stock_movements_refType_refId_idx`(`refType`, `refId`),
    INDEX `erp_stock_movements_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_stock_movements_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `erp_warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `erp_stock_movements_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_bom_headers` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL DEFAULT 'v1.0',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `remark` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `erp_bom_headers_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `erp_bom_items` (
    `id` VARCHAR(191) NOT NULL,
    `bomId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `parentItemId` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `erp_bom_items_bomId_idx`(`bomId`),
    INDEX `erp_bom_items_materialId_idx`(`materialId`),
    INDEX `erp_bom_items_parentItemId_idx`(`parentItemId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_bom_items_bomId_fkey` FOREIGN KEY (`bomId`) REFERENCES `erp_bom_headers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `erp_bom_items_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `erp_bom_items_parentItemId_fkey` FOREIGN KEY (`parentItemId`) REFERENCES `erp_bom_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
