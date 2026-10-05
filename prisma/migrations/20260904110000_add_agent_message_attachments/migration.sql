-- 小川第 2 期段 2：agent_messages 增加附件列（纯新增一列，不修改任何既有数据）。
ALTER TABLE `agent_messages` ADD COLUMN `attachments` JSON NULL;
