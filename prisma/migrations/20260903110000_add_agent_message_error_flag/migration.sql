-- 小川消息增加错误标记：仅新增可空列，不修改既有列或历史数据。
ALTER TABLE `agent_messages`
    ADD COLUMN `error` BOOLEAN NULL;
