-- DachuanPro v2.0 phase 5: additive StockIn void state and immutable void audit.
-- Existing stock-in records receive CONFIRMED by the column default. This migration
-- does not write, recalculate, delete, or otherwise alter inventory or stock movements.

ALTER TABLE `erp_stock_ins`
  ADD COLUMN `status` ENUM('DRAFT','CONFIRMED','VOIDED') NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN `voidedAt` DATETIME(3) NULL,
  ADD COLUMN `voidedById` VARCHAR(191) NULL,
  ADD COLUMN `voidReason` TEXT NULL;

CREATE INDEX `idx_stock_in_status` ON `erp_stock_ins`(`status`);

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
