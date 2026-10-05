-- Phase 2: payment edits, contract unlock approvals, and operation logs.
-- Additive migration only. No legacy data, columns, or tables are removed.

-- AlterTable
ALTER TABLE `contract_payments`
  ADD COLUMN `status` ENUM('ACTIVE', 'VOIDED') NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE `contracts`
  ADD COLUMN `editUnlockedUntil` DATETIME(3) NULL,
  ADD COLUMN `editUnlockRequestId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `contract_unlock_requests` (
  `id` VARCHAR(191) NOT NULL,
  `contractId` VARCHAR(191) NOT NULL,
  `requesterId` VARCHAR(191) NOT NULL,
  `approverId` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'USED') NOT NULL DEFAULT 'PENDING',
  `reason` TEXT NOT NULL,
  `approvalRemark` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approvedAt` DATETIME(3) NULL,
  `rejectedAt` DATETIME(3) NULL,
  `usedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `contract_unlock_requests_contractId_idx`(`contractId`),
  INDEX `contract_unlock_requests_requesterId_idx`(`requesterId`),
  INDEX `contract_unlock_requests_approverId_idx`(`approverId`),
  INDEX `contract_unlock_requests_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `operation_logs` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `entityType` VARCHAR(191) NOT NULL,
  `entityId` VARCHAR(191) NOT NULL,
  `beforeData` JSON NULL,
  `afterData` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `operation_logs_userId_idx`(`userId`),
  INDEX `operation_logs_action_idx`(`action`),
  INDEX `operation_logs_entityType_idx`(`entityType`),
  INDEX `operation_logs_entityId_idx`(`entityId`),
  INDEX `operation_logs_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill existing payments as active explicitly.
UPDATE `contract_payments` SET `status` = 'ACTIVE' WHERE `status` IS NULL;

-- AddForeignKey
ALTER TABLE `contract_unlock_requests` ADD CONSTRAINT `contract_unlock_requests_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `contracts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_unlock_requests` ADD CONSTRAINT `contract_unlock_requests_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_unlock_requests` ADD CONSTRAINT `contract_unlock_requests_approverId_fkey` FOREIGN KEY (`approverId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `operation_logs` ADD CONSTRAINT `operation_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
