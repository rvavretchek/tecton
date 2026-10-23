-- CreateTable
CREATE TABLE `service_credentials` (
    `id` CHAR(36) NOT NULL,
    `domain` VARCHAR(63) NOT NULL,
    `secret_hash` VARCHAR(256) NOT NULL,
    `permissions` JSON NOT NULL,
    `callees` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_credentials_domain_key`(`domain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
