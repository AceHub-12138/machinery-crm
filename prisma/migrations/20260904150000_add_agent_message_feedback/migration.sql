-- 小川第 2 期段 5：agent_messages 增加反馈列（点赞/点踩，纯新增一列，不修改任何既有数据）。
-- 取值：'up'=有帮助，'down'=没帮助，NULL=未评价；仅 assistant 行使用。
ALTER TABLE `agent_messages` ADD COLUMN `feedback` VARCHAR(191) NULL;
