-- 回滚仅删除本次新增的会话版本列，不影响账号、会话或业务数据。
ALTER TABLE `agent_accounts`
    DROP COLUMN `sessionVersion`;
