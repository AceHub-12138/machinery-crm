-- 回滚：删除 agent_messages 的附件列（仅移除该列及其数据，不影响消息正文等其他数据）。
-- ⚠️ 执行前如需保留已发送附件的记录，请先备份 agent_messages 表。
ALTER TABLE `agent_messages` DROP COLUMN `attachments`;
