-- CreateTable
CREATE TABLE `credentials` (
    `id` CHAR(36) NOT NULL,
    -- Binary collation, edited by hand (Prisma does not model collations): the table default
    -- utf8mb4_unicode_ci ignores case and accents, so "jose" and "josé" would collide in MySQL/MariaDB
    -- but not in PostgreSQL. Logins are already normalized (NFKC, lowercase) in code.
    `login` VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `password_hash` VARCHAR(256) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `permissions` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `credentials_login_key`(`login`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
