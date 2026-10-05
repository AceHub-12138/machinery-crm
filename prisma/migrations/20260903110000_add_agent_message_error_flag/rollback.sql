-- 回滚：仅删除小川消息的错误标记列（不涉及任何业务数据）。
ALTER TABLE `agent_messages` DROP COLUMN `error`;
