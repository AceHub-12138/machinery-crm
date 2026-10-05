SET FOREIGN_KEY_CHECKS=0;

-- AlterTable
ALTER TABLE `erp_stock_ins` ADD COLUMN `purchaseOrderId` VARCHAR(191) NULL;
CREATE INDEX `erp_stock_ins_purchaseOrderId_idx` ON `erp_stock_ins`(`purchaseOrderId`);

-- AlterTable
ALTER TABLE `erp_stock_in_items` ADD COLUMN `purchaseOrderItemId` VARCHAR(191) NULL;
CREATE INDEX `erp_stock_in_items_purchaseOrderItemId_idx` ON `erp_stock_in_items`(`purchaseOrderItemId`);

SET FOREIGN_KEY_CHECKS=1;
