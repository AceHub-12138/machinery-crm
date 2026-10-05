-- AI 获客助手（lead-hunter）：新增任务表 + 候选表。纯新增，不修改任何既有表与数据。
CREATE TABLE `lead_hunt_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `config` JSON NOT NULL,
    `progress` JSON NULL,
    `report` JSON NULL,
    `error` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `lead_hunt_tasks_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `lead_hunt_tasks_createdAt_idx`(`createdAt`),
    CONSTRAINT `lead_hunt_tasks_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lead_hunt_candidates` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL,
    `sourceUrl` VARCHAR(2048) NULL,
    `snippet` TEXT NULL,
    `keywords` JSON NULL,
    `round` INTEGER NULL,
    `score` INTEGER NULL,
    `scoreReason` TEXT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `province` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `tianyancha` JSON NULL,
    `leadId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `lead_hunt_candidates_taskId_status_idx`(`taskId`, `status`),
    CONSTRAINT `lead_hunt_candidates_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `lead_hunt_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
