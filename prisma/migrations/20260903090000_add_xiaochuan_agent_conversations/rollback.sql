-- 回滚：仅删除小川 AI 助手的两张对话表（只涉及 AI 对话记录，不涉及任何业务数据）。
-- 执行前如需保留对话历史，请先自行导出备份。
DROP TABLE IF EXISTS `agent_messages`;
DROP TABLE IF EXISTS `agent_conversations`;
