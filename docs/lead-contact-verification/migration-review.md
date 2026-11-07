# 数据库迁移审阅

只新增可空字段和两张表；不回填旧数据。MySQL DDL 可能锁表且不保证事务回滚，必须先在独立测试库验证。所有新外键为 RESTRICT，保护核验审计记录。未执行任何数据库迁移。

## migration.sql

```sql
-- 纯新增；不回填历史数据。MySQL 5.7。DDL 可能锁表，请先备份并在维护窗口执行。
ALTER TABLE `leads`
  ADD COLUMN `contactStatus` VARCHAR(32) NULL,
  ADD COLUMN `contactStatusUpdatedAt` DATETIME(3) NULL,
  ADD COLUMN `phoneSource` VARCHAR(32) NULL,
  ADD COLUMN `phoneEvidence` JSON NULL,
  ADD COLUMN `phoneVerifiedAt` DATETIME(3) NULL,
  ADD COLUMN `tycCompanyId` VARCHAR(64) NULL,
  ADD COLUMN `creditCode` VARCHAR(32) NULL;
ALTER TABLE `lead_hunt_candidates`
  ADD COLUMN `contactName` VARCHAR(64) NULL,
  ADD COLUMN `phoneSource` VARCHAR(32) NULL,
  ADD COLUMN `phoneEvidence` JSON NULL,
  ADD COLUMN `dedupKey` VARCHAR(64) NULL,
  ADD COLUMN `statusReason` VARCHAR(191) NULL;
CREATE INDEX `leads_contactStatus_idx` ON `leads`(`contactStatus`);
CREATE INDEX `leads_creditCode_idx` ON `leads`(`creditCode`);
CREATE INDEX `leads_phone_idx` ON `leads`(`phone`);
CREATE INDEX `lead_hunt_candidates_dedupKey_idx` ON `lead_hunt_candidates`(`dedupKey`);

CREATE TABLE `lead_contact_lookups` (
  `id` VARCHAR(191) NOT NULL,
  `leadId` VARCHAR(191) NOT NULL,
  `requestedById` VARCHAR(191) NOT NULL,
  `queryName` VARCHAR(100) NOT NULL,
  `queryNameNormalized` VARCHAR(191) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `reason` VARCHAR(191) NULL,
  `matchedName` VARCHAR(191) NULL,
  `tycCompanyId` VARCHAR(64) NULL,
  `creditCode` VARCHAR(32) NULL,
  `regStatus` VARCHAR(64) NULL,
  `phones` JSON NULL,
  `emails` JSON NULL,
  `rawResponse` JSON NULL,
  `charged` BOOLEAN NOT NULL DEFAULT false,
  `isMock` BOOLEAN NOT NULL DEFAULT false,
  `cacheOfLookupId` VARCHAR(191) NULL,
  `confirmedById` VARCHAR(191) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `lead_contact_lookups_leadId_createdAt_idx` (`leadId`, `createdAt`),
  INDEX `lead_contact_lookups_queryNameNormalized_createdAt_idx` (`queryNameNormalized`, `createdAt`),
  INDEX `lead_contact_lookups_status_createdAt_idx` (`status`, `createdAt`),
  INDEX `lead_contact_lookups_requestedById_idx` (`requestedById`),
  INDEX `lead_contact_lookups_confirmedById_idx` (`confirmedById`),
  CONSTRAINT `lead_contact_lookups_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `leads` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lead_contact_lookups_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `lead_contact_lookups_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lead_lookup_daily_quotas` (
  `quotaDate` CHAR(10) NOT NULL,
  `used` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`quotaDate`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## rollback.sql

优先只回滚代码。以下脚本会丢失本期新增核验数据，必须先导出，不能直接在生产试运行。

```sql
-- 警告：回滚会丢失核验记录、新列核验数据与额度数据。执行前必须导出。优先只回滚代码，保留新增结构。
DROP TABLE `lead_contact_lookups`;
DROP TABLE `lead_lookup_daily_quotas`;
DROP INDEX `leads_contactStatus_idx` ON `leads`;
DROP INDEX `leads_creditCode_idx` ON `leads`;
DROP INDEX `leads_phone_idx` ON `leads`;
DROP INDEX `lead_hunt_candidates_dedupKey_idx` ON `lead_hunt_candidates`;
ALTER TABLE `leads` DROP COLUMN `contactStatus`, DROP COLUMN `contactStatusUpdatedAt`, DROP COLUMN `phoneSource`, DROP COLUMN `phoneEvidence`, DROP COLUMN `phoneVerifiedAt`, DROP COLUMN `tycCompanyId`, DROP COLUMN `creditCode`;
ALTER TABLE `lead_hunt_candidates` DROP COLUMN `contactName`, DROP COLUMN `phoneSource`, DROP COLUMN `phoneEvidence`, DROP COLUMN `dedupKey`, DROP COLUMN `statusReason`;
```
