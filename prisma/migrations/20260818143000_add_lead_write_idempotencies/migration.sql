-- Preserve every accepted Lead ingestion idempotency key after company-level merges.
-- Existing Lead columns remain unchanged for backward compatibility.
CREATE TABLE `lead_write_idempotencies` (
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `payloadHash` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `lead_write_idempotencies_leadId_createdAt_idx`(`leadId`, `createdAt`),
    PRIMARY KEY (`idempotencyKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `lead_write_idempotencies` (`idempotencyKey`, `payloadHash`, `leadId`, `createdAt`)
SELECT `idempotencyKey`, `payloadHash`, `id`, `createdAt`
FROM `leads`
WHERE `idempotencyKey` IS NOT NULL
  AND `payloadHash` IS NOT NULL;
