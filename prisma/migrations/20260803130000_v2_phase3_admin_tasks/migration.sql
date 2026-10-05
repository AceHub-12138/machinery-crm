-- DachuanPro v2.0 phase 3: additive task, platform-admin and controlled deletion support.
-- Manual review/import only; no DROP, TRUNCATE, DELETE or historical data rewrite.

ALTER TABLE `erp_kit_check_results`
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `deletedById` VARCHAR(191) NULL,
  ADD COLUMN `deleteReason` TEXT NULL;
CREATE INDEX `idx_kit_result_deleted` ON `erp_kit_check_results`(`deletedAt`);

CREATE TABLE `system_user_task_states` (
  `id` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL,
  `sourceType` VARCHAR(191) NOT NULL, `sourceId` VARCHAR(191) NOT NULL,
  `readAt` DATETIME(3) NULL, `pinnedAt` DATETIME(3) NULL, `ignoredAt` DATETIME(3) NULL, `lastViewedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `uq_system_task_state_source`(`userId`,`sourceType`,`sourceId`), INDEX `idx_system_task_user_state`(`userId`,`ignoredAt`),
  CONSTRAINT `fk_system_task_user` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_settings` (
  `id` VARCHAR(191) NOT NULL, `key` VARCHAR(191) NOT NULL, `value` JSON NOT NULL, `updatedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `uq_system_setting_key`(`key`),
  CONSTRAINT `fk_system_setting_user` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_permission_definitions` (
  `id` VARCHAR(191) NOT NULL, `code` VARCHAR(191) NOT NULL, `module` VARCHAR(191) NOT NULL, `action` VARCHAR(64) NOT NULL, `description` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `uq_system_permission_code`(`code`), UNIQUE INDEX `uq_system_permission_module_action`(`module`,`action`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_role_permissions` (
  `id` VARCHAR(191) NOT NULL, `role` ENUM('SUPER_ADMIN','SALES','FOREIGN_TRADE','PURCHASE','WAREHOUSE') NOT NULL, `permissionId` VARCHAR(191) NOT NULL, `allowed` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `uq_system_role_permission`(`role`,`permissionId`), INDEX `idx_system_role_permission_role`(`role`),
  CONSTRAINT `fk_system_role_permission_def` FOREIGN KEY (`permissionId`) REFERENCES `system_permission_definitions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_purchase_order_delete_requests` (
  `id` VARCHAR(191) NOT NULL, `purchaseOrderId` VARCHAR(191) NOT NULL, `requesterId` VARCHAR(191) NOT NULL, `approverId` VARCHAR(191) NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING', `reason` TEXT NOT NULL, `approvalRemark` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `approvedAt` DATETIME(3) NULL, `rejectedAt` DATETIME(3) NULL, `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), INDEX `idx_po_delete_request_order`(`purchaseOrderId`), INDEX `idx_po_delete_request_requester`(`requesterId`), INDEX `idx_po_delete_request_status`(`status`),
  CONSTRAINT `fk_po_delete_request_order` FOREIGN KEY (`purchaseOrderId`) REFERENCES `erp_purchase_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_po_delete_request_requester` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_po_delete_request_approver` FOREIGN KEY (`approverId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `erp_kit_check_delete_requests` (
  `id` VARCHAR(191) NOT NULL, `kitCheckResultId` VARCHAR(191) NOT NULL, `requesterId` VARCHAR(191) NOT NULL, `approverId` VARCHAR(191) NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING', `reason` TEXT NOT NULL, `approvalRemark` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `approvedAt` DATETIME(3) NULL, `rejectedAt` DATETIME(3) NULL, `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), INDEX `idx_kit_delete_request_result`(`kitCheckResultId`), INDEX `idx_kit_delete_request_requester`(`requesterId`), INDEX `idx_kit_delete_request_status`(`status`),
  CONSTRAINT `fk_kit_delete_request_result` FOREIGN KEY (`kitCheckResultId`) REFERENCES `erp_kit_check_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_kit_delete_request_requester` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_kit_delete_request_approver` FOREIGN KEY (`approverId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
