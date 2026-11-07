-- 警告：回滚会丢失核验记录、新列核验数据与额度数据。执行前必须导出。优先只回滚代码，保留新增结构。
DROP TABLE `lead_contact_lookups`;
DROP TABLE `lead_lookup_daily_quotas`;
DROP INDEX `leads_contactStatus_idx` ON `leads`;
DROP INDEX `leads_creditCode_idx` ON `leads`;
DROP INDEX `leads_phone_idx` ON `leads`;
DROP INDEX `lead_hunt_candidates_dedupKey_idx` ON `lead_hunt_candidates`;
ALTER TABLE `leads` DROP COLUMN `contactStatus`, DROP COLUMN `contactStatusUpdatedAt`, DROP COLUMN `phoneSource`, DROP COLUMN `phoneEvidence`, DROP COLUMN `phoneVerifiedAt`, DROP COLUMN `tycCompanyId`, DROP COLUMN `creditCode`;
ALTER TABLE `lead_hunt_candidates` DROP COLUMN `contactName`, DROP COLUMN `phoneSource`, DROP COLUMN `phoneEvidence`, DROP COLUMN `dedupKey`, DROP COLUMN `statusReason`;
