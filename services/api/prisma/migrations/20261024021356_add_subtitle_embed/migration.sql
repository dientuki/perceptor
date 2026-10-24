-- CreateTable
CREATE TABLE `subtitle_embeds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `movieId` INTEGER NULL,
    `episodeId` INTEGER NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `filePath` VARCHAR(500) NOT NULL,
    `tracks` JSON NOT NULL,
    `errorKey` VARCHAR(100) NULL,
    `warningKey` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `subtitle_embeds_movieId_createdAt_idx`(`movieId`, `createdAt`),
    INDEX `subtitle_embeds_episodeId_createdAt_idx`(`episodeId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `subtitle_embeds` ADD CONSTRAINT `subtitle_embeds_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `movies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subtitle_embeds` ADD CONSTRAINT `subtitle_embeds_episodeId_fkey` FOREIGN KEY (`episodeId`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
