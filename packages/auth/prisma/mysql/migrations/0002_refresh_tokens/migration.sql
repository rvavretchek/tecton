-- CreateTable
CREATE TABLE `refresh_families` (
    `id` CHAR(36) NOT NULL,
    `credential_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_reason` VARCHAR(16) NULL,

    INDEX `refresh_families_credential_id_idx`(`credential_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `family_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_family_id_idx`(`family_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_families` ADD CONSTRAINT `refresh_families_credential_id_fkey` FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_family_id_fkey` FOREIGN KEY (`family_id`) REFERENCES `refresh_families`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
