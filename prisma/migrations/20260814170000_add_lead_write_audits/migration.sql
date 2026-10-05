-- Batch 03 Lead command audit. Additive only; no existing table is altered.
CREATE TABLE `lead_write_audits` (
    `id` VARCHAR(191) NOT NULL,
    `principalType` ENUM('SERVICE', 'USER') NOT NULL,
    `principalId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `outcome` ENUM('CREATED', 'REPLAY', 'CONFLICT') NOT NULL,
    `payloadHash` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_write_audits_principalType_principalId_createdAt_idx`(`principalType`, `principalId`, `createdAt`),
    INDEX `lead_write_audits_idempotencyKey_createdAt_idx`(`idempotencyKey`, `createdAt`),
    INDEX `lead_write_audits_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `lead_write_audits_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
