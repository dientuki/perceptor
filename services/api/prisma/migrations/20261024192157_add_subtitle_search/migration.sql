-- AlterTable
ALTER TABLE `user_movies` ADD COLUMN `subtitleSearch` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user_shows` ADD COLUMN `subtitleSearch` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `subtitleSearch` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `subtitle_searches` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `movieId` INTEGER NULL,
    `episodeId` INTEGER NULL,
    `status` ENUM('WAITING', 'SEARCHING', 'VALIDATING', 'EMBEDDING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'WAITING',
    `errorKey` VARCHAR(100) NULL,
    `wantedLanguages` JSON NOT NULL,
    `presentLanguages` JSON NULL,
    `itemId` VARCHAR(100) NULL,
    `subtitleEmbedId` INTEGER NULL,
    `checkCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `subtitle_searches_status_idx`(`status`),
    INDEX `subtitle_searches_movieId_createdAt_idx`(`movieId`, `createdAt`),
    INDEX `subtitle_searches_episodeId_createdAt_idx`(`episodeId`, `createdAt`),
    INDEX `subtitle_searches_subtitleEmbedId_idx`(`subtitleEmbedId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subtitle_search_attempts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `searchId` INTEGER NOT NULL,
    `languageIso3` VARCHAR(3) NOT NULL,
    `providerSubtitleId` VARCHAR(255) NOT NULL,
    `releaseName` VARCHAR(500) NOT NULL,
    `rank` INTEGER NOT NULL,
    `stagedPath` VARCHAR(500) NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'ACCEPTED', 'REJECTED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `offsetMs` INTEGER NULL,
    `framerateRatio` DOUBLE NULL,
    `reference` ENUM('SUBTITLE', 'AUDIO') NULL,
    `score` DOUBLE NULL,
    `reasonKey` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `subtitle_search_attempts_searchId_languageIso3_idx`(`searchId`, `languageIso3`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `subtitle_searches` ADD CONSTRAINT `subtitle_searches_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `movies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subtitle_searches` ADD CONSTRAINT `subtitle_searches_episodeId_fkey` FOREIGN KEY (`episodeId`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subtitle_searches` ADD CONSTRAINT `subtitle_searches_subtitleEmbedId_fkey` FOREIGN KEY (`subtitleEmbedId`) REFERENCES `subtitle_embeds`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subtitle_search_attempts` ADD CONSTRAINT `subtitle_search_attempts_searchId_fkey` FOREIGN KEY (`searchId`) REFERENCES `subtitle_searches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
