-- CreateTable
CREATE TABLE `shipments` (
    `id` VARCHAR(191) NOT NULL,
    `contractId` VARCHAR(191) NOT NULL,
    `shipmentDate` DATE NOT NULL,
    `receivingAddress` TEXT NOT NULL,
    `driverPhone` VARCHAR(191) NOT NULL,
    `equipmentName` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `shipmentStatus` ENUM('NOT_SHIPPED', 'PARTIAL_SHIPPED', 'SHIPPED') NOT NULL DEFAULT 'NOT_SHIPPED',
    `deliveryNoteUrl` VARCHAR(191) NULL,
    `shipmentPhotoUrl` VARCHAR(191) NULL,
    `remark` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `shipments_contractId_idx`(`contractId`),
    INDEX `shipments_shipmentStatus_idx`(`shipmentStatus`),
    INDEX `shipments_shipmentDate_idx`(`shipmentDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `contracts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
