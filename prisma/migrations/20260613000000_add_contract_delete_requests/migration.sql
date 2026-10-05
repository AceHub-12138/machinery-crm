-- Add contract deletion approval workflow.
-- Additive migration only. Creates ONE new table; no existing table, column, or row is modified or removed.

-- CreateTable
CREATE TABLE `contract_delete_requests` (
  `id` VARCHAR(191) NOT NULL,
  `contractId` VARCHAR(191) NOT NULL,
  `requesterId` VARCHAR(191) NOT NULL,
  `approverId` VARCHAR(191) NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `reason` TEXT NOT NULL,
  `approvalRemark` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approvedAt` DATETIME(3) NULL,
  `rejectedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `contract_delete_requests_contractId_idx`(`contractId`),
  INDEX `contract_delete_requests_requesterId_idx`(`requesterId`),
  INDEX `contract_delete_requests_approverId_idx`(`approverId`),
  INDEX `contract_delete_requests_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `contract_delete_requests` ADD CONSTRAINT `contract_delete_requests_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `contracts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_delete_requests` ADD CONSTRAINT `contract_delete_requests_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_delete_requests` ADD CONSTRAINT `contract_delete_requests_approverId_fkey` FOREIGN KEY (`approverId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
