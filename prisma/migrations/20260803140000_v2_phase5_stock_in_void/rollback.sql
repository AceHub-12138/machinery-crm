-- DachuanPro v2.0 phase 5 rollback runbook.
-- This script is for a pre-production rollback only. It does not touch any legacy
-- StockIn, inventory, or stock movement record. If any phase-5 void fact exists,
-- every prepared statement becomes a no-op and the schema is deliberately retained.
-- Do not use this script to erase production audit data; use an approved business
-- compensation flow instead.

SELECT COUNT(*) INTO @phase5_void_count
FROM `erp_stock_ins`
WHERE `status` = 'VOIDED';

SELECT COUNT(*) INTO @phase5_void_audit_count
FROM `erp_stock_in_voids`;

SET @phase5_rollback_allowed = IF(@phase5_void_count = 0 AND @phase5_void_audit_count = 0, 1, 0);

SELECT @phase5_rollback_allowed AS `phase5_rollback_allowed`,
       @phase5_void_count AS `phase5_void_count`,
       @phase5_void_audit_count AS `phase5_void_audit_count`;

SET @phase5_sql = IF(@phase5_rollback_allowed = 1,
  'DROP TABLE `erp_stock_in_void_items`',
  'SELECT ''phase5 rollback blocked: void audit data exists''');
PREPARE phase5_rollback_statement FROM @phase5_sql;
EXECUTE phase5_rollback_statement;
DEALLOCATE PREPARE phase5_rollback_statement;

SET @phase5_sql = IF(@phase5_rollback_allowed = 1,
  'DROP TABLE `erp_stock_in_voids`',
  'SELECT ''phase5 rollback blocked: void audit data exists''');
PREPARE phase5_rollback_statement FROM @phase5_sql;
EXECUTE phase5_rollback_statement;
DEALLOCATE PREPARE phase5_rollback_statement;

SET @phase5_sql = IF(@phase5_rollback_allowed = 1,
  'DROP INDEX `idx_stock_in_status` ON `erp_stock_ins`',
  'SELECT ''phase5 rollback blocked: void audit data exists''');
PREPARE phase5_rollback_statement FROM @phase5_sql;
EXECUTE phase5_rollback_statement;
DEALLOCATE PREPARE phase5_rollback_statement;

SET @phase5_sql = IF(@phase5_rollback_allowed = 1,
  'ALTER TABLE `erp_stock_ins` DROP COLUMN `voidReason`, DROP COLUMN `voidedById`, DROP COLUMN `voidedAt`, DROP COLUMN `status`',
  'SELECT ''phase5 rollback blocked: void audit data exists''');
PREPARE phase5_rollback_statement FROM @phase5_sql;
EXECUTE phase5_rollback_statement;
DEALLOCATE PREPARE phase5_rollback_statement;
