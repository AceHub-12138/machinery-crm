-- 小川第 3 期：Agent 独立账号体系 + 模型配置。纯新增四张表；
-- agent_conversations 仅做两处无数据损失的结构放宽（userId 改可空 + 新增 agent_account_id 列），不修改任何既有数据。

-- Agent 独立账号（与 CRM users 表完全分离，仅能登录 Agent 平台）
CREATE TABLE `agent_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `remark` VARCHAR(191) NULL,
    `dailyQuota` INTEGER NOT NULL DEFAULT 50,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `agent_accounts_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Agent 账号每日提问用量（每账号每天一行）
CREATE TABLE `agent_usage_daily` (
    `id` VARCHAR(191) NOT NULL,
    `agentAccountId` VARCHAR(191) NOT NULL,
    `usageDate` DATE NOT NULL,
    `questionCount` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `agent_usage_daily_agentAccountId_usageDate_key`(`agentAccountId`, `usageDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Agent 模型服务配置（多套保存、单套生效；API Key 加密存储）
CREATE TABLE `agent_model_configs` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `baseUrl` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `apiKeyCipher` TEXT NOT NULL,
    `apiKeyHint` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Agent 账号的工具调用审计（与员工同纪律逐次审计；独立成表避免触碰带 users 外键的既有审计表）
CREATE TABLE `agent_account_audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `agentAccountId` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `toolName` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `rejectionReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_account_audit_logs_agentAccountId_createdAt_idx`(`agentAccountId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 会话双归属改造：userId 放宽为可空（既有行全部保持原值不变），新增 agent_account_id 列
ALTER TABLE `agent_conversations` MODIFY `userId` VARCHAR(191) NULL;

ALTER TABLE `agent_conversations` ADD COLUMN `agentAccountId` VARCHAR(191) NULL,
    ADD INDEX `agent_conversations_agentAccountId_updatedAt_idx`(`agentAccountId`, `updatedAt`);

ALTER TABLE `agent_usage_daily` ADD CONSTRAINT `agent_usage_daily_agentAccountId_fkey` FOREIGN KEY (`agentAccountId`) REFERENCES `agent_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `agent_account_audit_logs` ADD CONSTRAINT `agent_account_audit_logs_agentAccountId_fkey` FOREIGN KEY (`agentAccountId`) REFERENCES `agent_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `agent_conversations` ADD CONSTRAINT `agent_conversations_agentAccountId_fkey` FOREIGN KEY (`agentAccountId`) REFERENCES `agent_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
