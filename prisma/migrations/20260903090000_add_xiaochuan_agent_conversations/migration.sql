-- 小川 AI 助手对话记忆：纯新增两张表，不修改既有表、列或任何历史数据。
CREATE TABLE `agent_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL DEFAULT '新对话',
    `thinkingTier` VARCHAR(191) NOT NULL DEFAULT 'standard',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `agent_conversations_userId_updatedAt_idx`(`userId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `agent_messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `thinkingTier` VARCHAR(191) NULL,
    `toolSummary` JSON NULL,
    `promptTokens` INTEGER NULL,
    `completionTokens` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `agent_conversations` ADD CONSTRAINT `agent_conversations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `agent_messages` ADD CONSTRAINT `agent_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `agent_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
