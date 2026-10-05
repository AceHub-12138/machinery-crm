-- 小川第 3 期 B 段：外部 MCP 服务配置（智谱联网搜索/网页读取等）。纯新增一张表，不修改任何既有数据。
CREATE TABLE `agent_mcp_servers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `apiKeyCipher` TEXT NULL,
    `apiKeyHint` VARCHAR(191) NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
