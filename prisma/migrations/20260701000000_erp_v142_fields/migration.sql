-- AlterTable
ALTER TABLE `erp_material_categories` ADD COLUMN `warningThreshold` DECIMAL(10, 2) NULL;

-- AlterTable
ALTER TABLE `erp_materials` ADD COLUMN `supplier` VARCHAR(191) NULL;
