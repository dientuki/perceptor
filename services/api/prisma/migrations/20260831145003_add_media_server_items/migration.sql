-- CreateTable
CREATE TABLE `media_server_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mediaType` VARCHAR(10) NOT NULL,
    `tmdbId` INTEGER NOT NULL,
    `externalId` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `media_server_items_mediaType_tmdbId_key`(`mediaType`, `tmdbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
