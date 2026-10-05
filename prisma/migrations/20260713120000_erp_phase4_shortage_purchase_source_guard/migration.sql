-- One active purchase-draft source claim is allowed for each kit-check shortage material.
-- isActive becomes NULL when a draft is cancelled or soft-deleted. MySQL permits
-- multiple NULL values in this unique index, preserving history while allowing regeneration.
CREATE TABLE `erp_purchase_order_shortage_sources` (
    `id` VARCHAR(191) NOT NULL,
    `purchaseOrderId` VARCHAR(191) NOT NULL,
    `purchaseOrderItemId` VARCHAR(191) NOT NULL,
    `kitCheckId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `releasedAt` DATETIME(3) NULL,

    UNIQUE INDEX `erp_po_shortage_src_kit_mat_active_uq`(`kitCheckId`, `materialId`, `isActive`),
    UNIQUE INDEX `erp_purchase_order_shortage_sources_purchaseOrderItemId_key`(`purchaseOrderItemId`),
    INDEX `erp_purchase_order_shortage_sources_purchaseOrderId_idx`(`purchaseOrderId`),
    INDEX `erp_purchase_order_shortage_sources_kitCheckId_idx`(`kitCheckId`),
    INDEX `erp_purchase_order_shortage_sources_materialId_idx`(`materialId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `erp_purchase_order_shortage_sources_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `erp_purchase_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `erp_purchase_order_shortage_sources_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `erp_purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `erp_purchase_order_shortage_sources_kitCheckId_fkey` FOREIGN KEY (`kitCheckId`) REFERENCES `erp_kit_check_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `erp_purchase_order_shortage_sources_materialId_fkey` FOREIGN KEY (`materialId`) REFERENCES `erp_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
