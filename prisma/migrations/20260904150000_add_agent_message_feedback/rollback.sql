-- 回滚：删除 agent_messages 的反馈列（仅移除点赞/点踩记录，不影响消息正文等其他数据）。
ALTER TABLE `agent_messages` DROP COLUMN `feedback`;
