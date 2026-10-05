-- Phase 1: product types, quote items, contract items, and quote-to-contract links.
-- This migration is additive and keeps all legacy columns/tables for rollback compatibility.

-- AlterEnum
ALTER TABLE `contracts`
  MODIFY `contractStatus` ENUM('DRAFT', 'SIGNED', 'CANCELLED', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'SIGNED';

-- AlterTable
ALTER TABLE `products`
  ADD COLUMN `productType` ENUM('MAIN', 'OPTIONAL') NOT NULL DEFAULT 'MAIN',
  ADD COLUMN `remark` TEXT NULL;

-- AlterTable
ALTER TABLE `contracts`
  ADD COLUMN `sourceQuoteId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `customer_quote_items` (
    `id` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `itemType` ENUM('MAIN', 'OPTIONAL') NOT NULL,
    `productNameSnapshot` VARCHAR(191) NOT NULL,
    `productModelSnapshot` VARCHAR(191) NOT NULL,
    `factoryPriceSnapshot` DECIMAL(12, 2) NULL,
    `quotedPrice` DECIMAL(12, 2) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_quote_items_quoteId_idx`(`quoteId`),
    INDEX `customer_quote_items_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_items` (
    `id` VARCHAR(191) NOT NULL,
    `contractId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `itemType` ENUM('MAIN', 'OPTIONAL') NOT NULL,
    `productNameSnapshot` VARCHAR(191) NOT NULL,
    `productModelSnapshot` VARCHAR(191) NOT NULL,
    `factoryPriceSnapshot` DECIMAL(12, 2) NULL,
    `contractPrice` DECIMAL(12, 2) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `contract_items_contractId_idx`(`contractId`),
    INDEX `contract_items_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `contracts_sourceQuoteId_key` ON `contracts`(`sourceQuoteId`);

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_sourceQuoteId_fkey` FOREIGN KEY (`sourceQuoteId`) REFERENCES `customer_quotes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_quote_items` ADD CONSTRAINT `customer_quote_items_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `customer_quotes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_quote_items` ADD CONSTRAINT `customer_quote_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_items` ADD CONSTRAINT `contract_items_contractId_fkey` FOREIGN KEY (`contractId`) REFERENCES `contracts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_items` ADD CONSTRAINT `contract_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing products as MAIN. The NOT NULL default handles current rows; this is explicit for safety.
UPDATE `products` SET `productType` = 'MAIN' WHERE `productType` IS NULL;

-- Backfill legacy single-product quotes into quote items.
INSERT INTO `customer_quote_items` (
    `id`,
    `quoteId`,
    `productId`,
    `itemType`,
    `productNameSnapshot`,
    `productModelSnapshot`,
    `factoryPriceSnapshot`,
    `quotedPrice`,
    `quantity`,
    `sortOrder`,
    `createdAt`,
    `updatedAt`
)
SELECT
    UUID(),
    q.`id`,
    q.`productId`,
    'MAIN',
    COALESCE(pt.`name`, p.`model`),
    p.`model`,
    q.`factoryPriceSnapshot`,
    q.`quotedPrice`,
    1,
    0,
    q.`createdAt`,
    q.`updatedAt`
FROM `customer_quotes` q
INNER JOIN `products` p ON p.`id` = q.`productId`
LEFT JOIN `product_translations` pt ON pt.`productId` = p.`id` AND pt.`language` = 'ZH'
WHERE NOT EXISTS (
    SELECT 1 FROM `customer_quote_items` qi WHERE qi.`quoteId` = q.`id`
);

-- Backfill legacy single-product contracts into contract items where productId is present.
-- Contracts without productId are preserved in legacy columns and can be manually completed later.
INSERT INTO `contract_items` (
    `id`,
    `contractId`,
    `productId`,
    `itemType`,
    `productNameSnapshot`,
    `productModelSnapshot`,
    `factoryPriceSnapshot`,
    `contractPrice`,
    `quantity`,
    `sortOrder`,
    `createdAt`,
    `updatedAt`
)
SELECT
    UUID(),
    c.`id`,
    c.`productId`,
    'MAIN',
    c.`equipmentName`,
    c.`equipmentModel`,
    p.`factoryPrice`,
    c.`amount`,
    1,
    0,
    c.`createdAt`,
    c.`updatedAt`
FROM `contracts` c
INNER JOIN `products` p ON p.`id` = c.`productId`
WHERE c.`productId` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `contract_items` ci WHERE ci.`contractId` = c.`id`
  );
