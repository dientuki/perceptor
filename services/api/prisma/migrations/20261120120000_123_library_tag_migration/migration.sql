
-- CreateTable
CREATE TABLE `library_tag_migrations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` ENUM('RUNNING', 'COMPLETED') NOT NULL DEFAULT 'RUNNING',
    `total` INTEGER NOT NULL DEFAULT 0,
    `processed` INTEGER NOT NULL DEFAULT 0,
    `migrated` INTEGER NOT NULL DEFAULT 0,
    `unchanged` INTEGER NOT NULL DEFAULT 0,
    `busy` INTEGER NOT NULL DEFAULT 0,
    `missing` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `library_tag_migration_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `migrationId` INTEGER NOT NULL,
    `movieId` INTEGER NULL,
    `episodeId` INTEGER NULL,
    `claimedAt` DATETIME(3) NULL,
    `outcome` ENUM('MIGRATED', 'UNCHANGED', 'BUSY', 'MISSING', 'FAILED') NULL,
    `reasonKey` VARCHAR(100) NULL,
    `hostPath` VARCHAR(500) NULL,
    `settledAt` DATETIME(3) NULL,

    INDEX `library_tag_migration_items_migrationId_outcome_idx`(`migrationId`, `outcome`),
    INDEX `library_tag_migration_items_movieId_idx`(`movieId`),
    INDEX `library_tag_migration_items_episodeId_idx`(`episodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `library_tag_migration_items` ADD CONSTRAINT `library_tag_migration_items_migrationId_fkey` FOREIGN KEY (`migrationId`) REFERENCES `library_tag_migrations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_tag_migration_items` ADD CONSTRAINT `library_tag_migration_items_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `movies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `library_tag_migration_items` ADD CONSTRAINT `library_tag_migration_items_episodeId_fkey` FOREIGN KEY (`episodeId`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

