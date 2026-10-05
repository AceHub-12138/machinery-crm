-- 回滚：仅删除本次新增的四张表与 agent_conversations 的新增列。
-- 安全前置校验：必须先恢复 userId NOT NULL。若存在 Agent 独立账号会话（userId IS NULL），
-- MySQL 5.7 会在第一条 ALTER 直接失败，后续 DROP 不会执行，避免半回滚；不得自动删除会话数据。
ALTER TABLE `agent_conversations` MODIFY `userId` VARCHAR(191) NOT NULL;

ALTER TABLE `agent_conversations` DROP FOREIGN KEY `agent_conversations_agentAccountId_fkey`;
ALTER TABLE `agent_conversations` DROP INDEX `agent_conversations_agentAccountId_updatedAt_idx`;
ALTER TABLE `agent_conversations` DROP COLUMN `agentAccountId`;

ALTER TABLE `agent_account_audit_logs` DROP FOREIGN KEY `agent_account_audit_logs_agentAccountId_fkey`;
ALTER TABLE `agent_usage_daily` DROP FOREIGN KEY `agent_usage_daily_agentAccountId_fkey`;

DROP TABLE `agent_account_audit_logs`;
DROP TABLE `agent_model_configs`;
DROP TABLE `agent_usage_daily`;
DROP TABLE `agent_accounts`;
