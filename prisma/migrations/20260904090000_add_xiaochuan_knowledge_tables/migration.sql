-- 小川知识库（第 2 期段 1）：纯新增三张知识表，不修改既有表、列或任何历史数据。
-- machine_capabilities   = 机型能力参数表（25 机型，来自画册 AI 抄录 + 技术部核对）
-- process_rule_cards     = 工艺规则卡（工艺师傅经验，可随时增量补充）
-- nc_program_templates   = 数控插床程序模板（广数 GSK / 凯恩帝 KND / 西门子 SIEMENS）
CREATE TABLE `machine_capabilities` (
    `id` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `fullName` TEXT NOT NULL,
    `mainObjects` TEXT NULL,
    `maxStrokeText` VARCHAR(191) NULL,
    `maxStrokeLengthMm` DOUBLE NULL,
    `tableSizeText` VARCHAR(191) NULL,
    `tableLoadKg` DOUBLE NULL,
    `maxModuleMm` DOUBLE NULL,
    `maxGearWidthMm` DOUBLE NULL,
    `maxOuterGearDiaMm` DOUBLE NULL,
    `maxInnerGearText` VARCHAR(191) NULL,
    `ramStrokeText` VARCHAR(191) NULL,
    `powerText` VARCHAR(191) NULL,
    `powerKw` DOUBLE NULL,
    `maxSpindleRpm` DOUBLE NULL,
    `travelsText` VARCHAR(191) NULL,
    `ramTiltText` VARCHAR(191) NULL,
    `netWeightText` VARCHAR(191) NULL,
    `dimensionsText` TEXT NULL,
    `optionsText` TEXT NULL,
    `notSuitableText` TEXT NULL,
    `sourceNote` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `machine_capabilities_model_key`(`model`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `process_rule_cards` (
    `id` VARCHAR(191) NOT NULL,
    `ruleNo` VARCHAR(191) NOT NULL,
    `conditionText` TEXT NOT NULL,
    `recommendModels` TEXT NOT NULL,
    `recommendProcess` TEXT NULL,
    `notRecommended` TEXT NULL,
    `rationale` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `process_rule_cards_ruleNo_key`(`ruleNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `nc_program_templates` (
    `id` VARCHAR(191) NOT NULL,
    `system` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `machineNote` VARCHAR(191) NULL,
    `program` TEXT NOT NULL,
    `paramNotes` TEXT NULL,
    `extraNotes` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `nc_program_templates_system_name_key`(`system`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
