-- AlterTable
ALTER TABLE `contracts` ADD COLUMN `estimatedShipmentDate` DATE NULL;

-- CreateIndex
CREATE INDEX `contracts_estimatedShipmentDate_idx` ON `contracts`(`estimatedShipmentDate`);
