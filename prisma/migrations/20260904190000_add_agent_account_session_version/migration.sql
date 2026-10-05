-- Agent 独立账号会话版本：管理员重置密码时递增，使此前签发的 30 天 Cookie 立即失效。
ALTER TABLE `agent_accounts`
    ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;
