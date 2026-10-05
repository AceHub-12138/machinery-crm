-- Add the internal procurement role without changing any existing user role.
ALTER TABLE `users`
  MODIFY `role` ENUM('SUPER_ADMIN', 'SALES', 'FOREIGN_TRADE', 'PURCHASE', 'WAREHOUSE') NOT NULL;

-- Existing production orders remain compatible because the new source link is nullable.
ALTER TABLE `erp_production_orders`
  ADD COLUMN `contractItemId` VARCHAR(191) NULL;

-- Nullable for existing orders; new UI/API requests use it as an idempotency key.
ALTER TABLE `erp_production_orders`
  ADD COLUMN `sourceRequestKey` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `uq_po_source_request`
  ON `erp_production_orders`(`sourceRequestKey`);

-- Existing kit checks stay unchanged; new executions record the frozen BOM version.
ALTER TABLE `erp_kit_check_results`
  ADD COLUMN `bomVersionSnapshot` VARCHAR(191) NULL;

CREATE INDEX `idx_po_contract_item`
  ON `erp_production_orders`(`contractItemId`);

ALTER TABLE `erp_production_orders`
  ADD CONSTRAINT `fk_po_contract_item`
  FOREIGN KEY (`contractItemId`) REFERENCES `contract_items`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
