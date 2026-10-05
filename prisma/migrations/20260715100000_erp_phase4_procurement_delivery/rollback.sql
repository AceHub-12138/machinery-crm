-- Run only after application code has been rolled back and after a verified database backup.
DROP TABLE `erp_notifications`;
DROP TABLE `erp_procurement_config`;
DROP TABLE `erp_attachments`;
DROP TABLE `erp_purchase_delivery_receipt_allocations`;
DROP TABLE `erp_purchase_demand_production_allocations`;
DROP TABLE `erp_stock_transfer_items`;
DROP TABLE `erp_stock_transfers`;
DROP TABLE `erp_purchase_delivery_batches`;
DROP TABLE `erp_supplier_promise_date_history`;
DROP TABLE `erp_supplier_delivery_followups`;
DROP TABLE `erp_kit_recheck_queue`;
DROP TABLE `erp_purchase_order_item_sources`;
DROP TABLE `erp_purchase_demands`;
DROP TABLE `erp_monthly_material_requirements`;
ALTER TABLE `erp_production_orders` DROP FOREIGN KEY `fk_po_month_plan_item`;
DROP TABLE `erp_monthly_production_plan_items`;
DROP TABLE `erp_monthly_production_plans`;
ALTER TABLE `erp_purchase_order_items`
  DROP INDEX `idx_po_item_latest_promise`,
  DROP INDEX `idx_po_item_delivery_status`,
  DROP INDEX `idx_po_item_responsible`,
  DROP COLUMN `responsibleId`, DROP COLUMN `deliveryStatus`,
  DROP COLUMN `actualArrivalDate`, DROP COLUMN `actualShipDate`,
  DROP COLUMN `estimatedShipDate`, DROP COLUMN `latestPromisedDate`,
  DROP COLUMN `firstPromisedDate`, DROP COLUMN `requiredDeliveryDate`,
  DROP COLUMN `needArrivalDate`;
ALTER TABLE `erp_stock_out_items`
  DROP COLUMN `afterQty`, DROP COLUMN `beforeQty`, DROP COLUMN `warehouseSnapshot`,
  DROP COLUMN `unitSnapshot`, DROP COLUMN `materialSpecSnapshot`,
  DROP COLUMN `materialNameSnapshot`, DROP COLUMN `materialCodeSnapshot`;
ALTER TABLE `erp_stock_outs`
  DROP COLUMN `sourceDocumentSnapshot`, DROP COLUMN `confirmedAt`, DROP COLUMN `confirmedById`;
ALTER TABLE `erp_stock_in_items`
  DROP COLUMN `afterQty`, DROP COLUMN `beforeQty`, DROP COLUMN `warehouseSnapshot`,
  DROP COLUMN `unitSnapshot`, DROP COLUMN `materialSpecSnapshot`,
  DROP COLUMN `materialNameSnapshot`, DROP COLUMN `materialCodeSnapshot`;
ALTER TABLE `erp_stock_ins`
  DROP COLUMN `sourceDocumentSnapshot`, DROP COLUMN `confirmedAt`, DROP COLUMN `confirmedById`;
ALTER TABLE `erp_kit_check_results`
  DROP INDEX `uq_kit_check_trigger`, DROP COLUMN `triggerType`, DROP COLUMN `triggerKey`;
ALTER TABLE `erp_production_orders`
  DROP INDEX `idx_po_month_plan_item`, DROP INDEX `idx_po_kit_required`,
  DROP COLUMN `monthlyPlanItemId`, DROP COLUMN `lastKitCheckedAt`,
  DROP COLUMN `latestKitCheckId`, DROP COLUMN `kitCheckRequired`,
  DROP COLUMN `kitCheckStatus`, DROP COLUMN `deliveryDateSnapshot`;
ALTER TABLE `erp_bom_headers` DROP INDEX `idx_bom_supersedes`, DROP COLUMN `supersedesId`;
ALTER TABLE `erp_materials`
  DROP COLUMN `autoPurchaseDraftEnabled`, DROP COLUMN `safetyStockEnabled`,
  DROP COLUMN `procurementLeadDays`, DROP COLUMN `maxStock`, DROP COLUMN `minStock`;
ALTER TABLE `contract_items` DROP INDEX `idx_contract_item_delivery`, DROP COLUMN `estimatedShipmentDate`;
