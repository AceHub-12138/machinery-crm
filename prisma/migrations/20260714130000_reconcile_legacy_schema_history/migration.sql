-- Reconcile schema changes that were applied to production outside the historical
-- Prisma migration chain. Every DDL statement is conditional and MySQL 5.7 compatible.

-- users.territories: add as nullable first so existing users can be backfilled safely.
SET @column_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'territories'
);
SET @ddl_sql = IF(
    @column_exists = 0,
    'ALTER TABLE `users` ADD COLUMN `territories` JSON NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- MySQL 5.7 cannot conditionally SIGNAL outside a stored program. Preparing a
-- query against this descriptive, intentionally absent table makes an unknown
-- source type fail loudly instead of marking a partial reconciliation as applied.
SET @column_type_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'territories' AND COLUMN_TYPE = 'json'
);
SET @ddl_sql = IF(
    @column_type_matches = 1,
    'DO 0',
    'SELECT * FROM `__ERROR_users_territories_must_be_json`'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @ddl_sql = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'territories') = 1,
    'UPDATE `users` SET `territories` = JSON_ARRAY() WHERE `territories` IS NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'territories'
      AND COLUMN_TYPE = 'json'
      AND IS_NULLABLE = 'NO'
      AND COLUMN_DEFAULT IS NULL
);
SET @ddl_sql = IF(
    @column_matches = 0
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
             AND COLUMN_NAME = 'territories' AND COLUMN_TYPE = 'json') = 1,
    'ALTER TABLE `users` MODIFY COLUMN `territories` JSON NOT NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- users.viewScope
SET @column_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'viewScope'
);
SET @ddl_sql = IF(
    @column_exists = 0,
    CONCAT('ALTER TABLE `users` ADD COLUMN `viewScope` VARCHAR(191) NOT NULL DEFAULT ', QUOTE('TERRITORY')),
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_type_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'viewScope' AND COLUMN_TYPE = 'varchar(191)'
);
SET @ddl_sql = IF(
    @column_type_matches = 1,
    'DO 0',
    'SELECT * FROM `__ERROR_users_viewScope_must_be_varchar191`'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @ddl_sql = 'UPDATE `users` SET `viewScope` = ''TERRITORY'' WHERE `viewScope` IS NULL';
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'viewScope'
      AND COLUMN_TYPE = 'varchar(191)'
      AND IS_NULLABLE = 'NO'
      AND (COLUMN_DEFAULT <=> 'TERRITORY')
);
SET @ddl_sql = IF(
    @column_matches = 0
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
             AND COLUMN_NAME = 'viewScope' AND COLUMN_TYPE = 'varchar(191)') = 1,
    CONCAT('ALTER TABLE `users` MODIFY COLUMN `viewScope` VARCHAR(191) NOT NULL DEFAULT ', QUOTE('TERRITORY')),
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- customers.province
SET @column_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'province'
);
SET @ddl_sql = IF(
    @column_exists = 0,
    'ALTER TABLE `customers` ADD COLUMN `province` VARCHAR(191) NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_type_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
      AND COLUMN_NAME = 'province' AND COLUMN_TYPE = 'varchar(191)'
);
SET @ddl_sql = IF(
    @column_type_matches = 1,
    'DO 0',
    'SELECT * FROM `__ERROR_customers_province_must_be_varchar191`'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'customers'
      AND COLUMN_NAME = 'province'
      AND COLUMN_TYPE = 'varchar(191)'
      AND IS_NULLABLE = 'YES'
      AND COLUMN_DEFAULT IS NULL
);
SET @ddl_sql = IF(
    @column_matches = 0
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
             AND COLUMN_NAME = 'province' AND COLUMN_TYPE = 'varchar(191)') = 1,
    'ALTER TABLE `customers` MODIFY COLUMN `province` VARCHAR(191) NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- customers.city
SET @column_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'city'
);
SET @ddl_sql = IF(
    @column_exists = 0,
    'ALTER TABLE `customers` ADD COLUMN `city` VARCHAR(191) NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_type_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
      AND COLUMN_NAME = 'city' AND COLUMN_TYPE = 'varchar(191)'
);
SET @ddl_sql = IF(
    @column_type_matches = 1,
    'DO 0',
    'SELECT * FROM `__ERROR_customers_city_must_be_varchar191`'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'customers'
      AND COLUMN_NAME = 'city'
      AND COLUMN_TYPE = 'varchar(191)'
      AND IS_NULLABLE = 'YES'
      AND COLUMN_DEFAULT IS NULL
);
SET @ddl_sql = IF(
    @column_matches = 0
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
             AND COLUMN_NAME = 'city' AND COLUMN_TYPE = 'varchar(191)') = 1,
    'ALTER TABLE `customers` MODIFY COLUMN `city` VARCHAR(191) NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- customers.businessLine
SET @column_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'businessLine'
);
SET @ddl_sql = IF(
    @column_exists = 0,
    CONCAT('ALTER TABLE `customers` ADD COLUMN `businessLine` VARCHAR(191) NOT NULL DEFAULT ', QUOTE('国内销售')),
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_type_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
      AND COLUMN_NAME = 'businessLine' AND COLUMN_TYPE = 'varchar(191)'
);
SET @ddl_sql = IF(
    @column_type_matches = 1,
    'DO 0',
    'SELECT * FROM `__ERROR_customers_businessLine_must_be_varchar191`'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @ddl_sql = 'UPDATE `customers` SET `businessLine` = ''国内销售'' WHERE `businessLine` IS NULL';
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'customers'
      AND COLUMN_NAME = 'businessLine'
      AND COLUMN_TYPE = 'varchar(191)'
      AND IS_NULLABLE = 'NO'
      AND (COLUMN_DEFAULT <=> '国内销售')
);
SET @ddl_sql = IF(
    @column_matches = 0
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
             AND COLUMN_NAME = 'businessLine' AND COLUMN_TYPE = 'varchar(191)') = 1,
    CONCAT('ALTER TABLE `customers` MODIFY COLUMN `businessLine` VARCHAR(191) NOT NULL DEFAULT ', QUOTE('国内销售')),
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- customers.region default
SET @column_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'region'
);
SET @ddl_sql = IF(
    @column_exists = 0,
    CONCAT('ALTER TABLE `customers` ADD COLUMN `region` VARCHAR(191) NOT NULL DEFAULT ', QUOTE('')),
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_type_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
      AND COLUMN_NAME = 'region' AND COLUMN_TYPE = 'varchar(191)'
);
SET @ddl_sql = IF(
    @column_type_matches = 1,
    'DO 0',
    'SELECT * FROM `__ERROR_customers_region_must_be_varchar191`'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @ddl_sql = 'UPDATE `customers` SET `region` = '''' WHERE `region` IS NULL';
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'customers'
      AND COLUMN_NAME = 'region'
      AND COLUMN_TYPE = 'varchar(191)'
      AND IS_NULLABLE = 'NO'
      AND (COLUMN_DEFAULT <=> '')
);
SET @ddl_sql = IF(
    @column_matches = 0
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
             AND COLUMN_NAME = 'region' AND COLUMN_TYPE = 'varchar(191)') = 1,
    CONCAT('ALTER TABLE `customers` MODIFY COLUMN `region` VARCHAR(191) NOT NULL DEFAULT ', QUOTE('')),
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- customers indexes
SET @index_matches = (
    SELECT COUNT(*) FROM (
        SELECT INDEX_NAME, NON_UNIQUE,
               GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS indexed_columns
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
          AND INDEX_NAME = 'customers_province_idx'
        GROUP BY INDEX_NAME, NON_UNIQUE
        HAVING NON_UNIQUE = 1 AND indexed_columns = 'province'
    ) AS expected_index
);
SET @ddl_sql = IF(
    @index_matches = 0,
    'ALTER TABLE `customers` ADD INDEX `customers_province_idx` (`province`)',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @index_matches = (
    SELECT COUNT(*) FROM (
        SELECT INDEX_NAME, NON_UNIQUE,
               GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS indexed_columns
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
          AND INDEX_NAME = 'customers_city_idx'
        GROUP BY INDEX_NAME, NON_UNIQUE
        HAVING NON_UNIQUE = 1 AND indexed_columns = 'city'
    ) AS expected_index
);
SET @ddl_sql = IF(
    @index_matches = 0,
    'ALTER TABLE `customers` ADD INDEX `customers_city_idx` (`city`)',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @index_matches = (
    SELECT COUNT(*) FROM (
        SELECT INDEX_NAME, NON_UNIQUE,
               GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS indexed_columns
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
          AND INDEX_NAME = 'customers_businessLine_idx'
        GROUP BY INDEX_NAME, NON_UNIQUE
        HAVING NON_UNIQUE = 1 AND indexed_columns = 'businessLine'
    ) AS expected_index
);
SET @ddl_sql = IF(
    @index_matches = 0,
    'ALTER TABLE `customers` ADD INDEX `customers_businessLine_idx` (`businessLine`)',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- follow_records.address
SET @column_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'follow_records' AND COLUMN_NAME = 'address'
);
SET @ddl_sql = IF(
    @column_exists = 0,
    'ALTER TABLE `follow_records` ADD COLUMN `address` TEXT NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_type_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'follow_records'
      AND COLUMN_NAME = 'address' AND COLUMN_TYPE = 'text'
);
SET @ddl_sql = IF(
    @column_type_matches = 1,
    'DO 0',
    'SELECT * FROM `__ERROR_follow_records_address_must_be_text`'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @column_matches = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'follow_records'
      AND COLUMN_NAME = 'address'
      AND COLUMN_TYPE = 'text'
      AND IS_NULLABLE = 'YES'
      AND COLUMN_DEFAULT IS NULL
);
SET @ddl_sql = IF(
    @column_matches = 0
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'follow_records'
             AND COLUMN_NAME = 'address' AND COLUMN_TYPE = 'text') = 1,
    'ALTER TABLE `follow_records` MODIFY COLUMN `address` TEXT NULL',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

-- Keep the shortage-source unique index under its explicit MySQL-safe Prisma mapping.
-- If a schema-push-created equivalent index exists, rename it without dropping data.
SET @shortage_table_exists = (
    SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'erp_purchase_order_shortage_sources'
);
SET @shortage_index_name_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'erp_purchase_order_shortage_sources'
      AND INDEX_NAME = 'erp_po_shortage_src_kit_mat_active_uq'
);
SET @matching_shortage_index = NULL;
SELECT matching.INDEX_NAME INTO @matching_shortage_index
FROM (
    SELECT INDEX_NAME,
           NON_UNIQUE,
           GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS indexed_columns
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'erp_purchase_order_shortage_sources'
    GROUP BY INDEX_NAME, NON_UNIQUE
    HAVING NON_UNIQUE = 0
       AND indexed_columns = 'kitCheckId,materialId,isActive'
    LIMIT 1
) AS matching;
SET @ddl_sql = IF(
    @shortage_table_exists = 1
      AND @shortage_index_name_exists = 0
      AND @matching_shortage_index IS NOT NULL,
    CONCAT(
        'ALTER TABLE `erp_purchase_order_shortage_sources` RENAME INDEX `',
        REPLACE(@matching_shortage_index, '`', '``'),
        '` TO `erp_po_shortage_src_kit_mat_active_uq`'
    ),
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;

SET @shortage_index_matches = (
    SELECT COUNT(*) FROM (
        SELECT INDEX_NAME, NON_UNIQUE,
               GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS indexed_columns
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'erp_purchase_order_shortage_sources'
          AND INDEX_NAME = 'erp_po_shortage_src_kit_mat_active_uq'
        GROUP BY INDEX_NAME, NON_UNIQUE
        HAVING NON_UNIQUE = 0 AND indexed_columns = 'kitCheckId,materialId,isActive'
    ) AS expected_index
);
SET @ddl_sql = IF(
    @shortage_table_exists = 1 AND @shortage_index_matches = 0,
    'ALTER TABLE `erp_purchase_order_shortage_sources` ADD UNIQUE INDEX `erp_po_shortage_src_kit_mat_active_uq` (`kitCheckId`, `materialId`, `isActive`)',
    'SELECT 1'
);
PREPARE reconcile_stmt FROM @ddl_sql;
EXECUTE reconcile_stmt;
DEALLOCATE PREPARE reconcile_stmt;
