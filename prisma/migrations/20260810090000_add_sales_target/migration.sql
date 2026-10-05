-- CreateTable
CREATE TABLE `sales_targets` (
    `id` VARCHAR(191) NOT NULL,
    `periodType` ENUM('MONTH', 'YEAR') NOT NULL,
    `periodYear` INTEGER NOT NULL,
    `periodIndex` INTEGER NOT NULL DEFAULT 0,
    `metric` ENUM('CONTRACT_AMOUNT', 'PAID_AMOUNT') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `salesUserId` VARCHAR(191) NULL,
    `note` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sales_targets_periodType_periodYear_periodIndex_idx`(`periodType`, `periodYear`, `periodIndex`),
    INDEX `sales_targets_salesUserId_idx`(`salesUserId`),
    UNIQUE INDEX `uq_sales_target_scope`(`periodType`, `periodYear`, `periodIndex`, `metric`, `salesUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_targets` ADD CONSTRAINT `sales_targets_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
