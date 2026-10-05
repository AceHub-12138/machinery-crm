-- Purchase drafts retain the production-order and kit-check source. Historical records remain unchanged.
ALTER TABLE `erp_purchase_orders` ADD COLUMN `sourceProductionOrderId` VARCHAR(191) NULL;
ALTER TABLE `erp_purchase_orders` ADD COLUMN `sourceKitCheckId` VARCHAR(191) NULL;
ALTER TABLE `erp_purchase_orders` ADD COLUMN `sourceShortageDetail` JSON NULL;
CREATE INDEX `erp_purchase_orders_sourceProductionOrderId_idx` ON `erp_purchase_orders`(`sourceProductionOrderId`);
CREATE INDEX `erp_purchase_orders_sourceKitCheckId_idx` ON `erp_purchase_orders`(`sourceKitCheckId`);
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `erp_purchase_orders_sourceProductionOrderId_fkey` FOREIGN KEY (`sourceProductionOrderId`) REFERENCES `erp_production_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `erp_purchase_orders` ADD CONSTRAINT `erp_purchase_orders_sourceKitCheckId_fkey` FOREIGN KEY (`sourceKitCheckId`) REFERENCES `erp_kit_check_results`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
