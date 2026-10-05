-- AI lead pool: additive schema only. Existing CRM/ERP tables and data are untouched.
CREATE TABLE `leads` (
    `id` VARCHAR(191) NOT NULL,
    `companyName` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `source` ENUM('BAIDU_SEARCH', 'MANUAL', 'OTHER') NOT NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `searchKeyword` VARCHAR(191) NULL,
    `aiScore` INTEGER NULL,
    `profile` JSON NULL,
    `sourceModelVersion` VARCHAR(191) NULL,
    `extractorVersion` VARCHAR(191) NULL,
    `sourceSystem` VARCHAR(191) NULL,
    `externalLeadId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `payloadHash` VARCHAR(191) NULL,
    `dedupKey` VARCHAR(191) NULL,
    `duplicateOfLeadId` VARCHAR(191) NULL,
    `duplicateConfidence` INTEGER NULL,
    `dedupStatus` ENUM('UNIQUE', 'PENDING_REVIEW', 'CONFIRMED_DUPLICATE', 'CONFIRMED_UNIQUE') NOT NULL DEFAULT 'UNIQUE',
    `reviewStatus` ENUM('PENDING', 'HIGH_INTENT', 'MID_INTENT', 'LOW_INTENT', 'INVALID') NOT NULL DEFAULT 'PENDING',
    `assignedUserId` VARCHAR(191) NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `convertedCustomerId` VARCHAR(191) NULL,
    `feedbackVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `leads_idempotencyKey_key`(`idempotencyKey`),
    UNIQUE INDEX `leads_dedupKey_key`(`dedupKey`),
    INDEX `leads_reviewStatus_idx`(`reviewStatus`),
    INDEX `leads_source_idx`(`source`),
    INDEX `leads_aiScore_idx`(`aiScore`),
    INDEX `leads_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `lead_feedback_events` (
    `id` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `reviewReasonCode` VARCHAR(191) NULL,
    `comment` VARCHAR(191) NULL,
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_feedback_events_leadId_reviewedAt_idx`(`leadId`, `reviewedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
