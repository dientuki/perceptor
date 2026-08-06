-- DropForeignKey
ALTER TABLE `process_jobs` DROP FOREIGN KEY `process_jobs_downloadTaskId_fkey`;

-- DropForeignKey
ALTER TABLE `movies` DROP FOREIGN KEY `movies_downloadTaskId_fkey`;

-- DropIndex
DROP INDEX `movies_downloadTaskId_key` ON `movies`;

-- AlterTable
ALTER TABLE `process_jobs` DROP COLUMN `downloadTaskId`,
    DROP COLUMN `inputFilePath`,
    ADD COLUMN `progress` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `sourceFileId` INTEGER NOT NULL,
    MODIFY `outputFilePath` VARCHAR(500) NULL,
    MODIFY `ffmpegCommand` TEXT NULL,
    MODIFY `errorMessage` TEXT NULL;

-- AlterTable
ALTER TABLE `movies` DROP COLUMN `downloadTaskId`,
    ADD COLUMN `mediaSourceId` INTEGER NULL,
    MODIFY `filePath` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `episodes` MODIFY `filePath` VARCHAR(500) NULL;

-- DropTable
DROP TABLE `download_tasks`;

-- CreateTable
CREATE TABLE `media_sources` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('TORRENT_SEARCH', 'TORRENT_FILE', 'LOCAL_FILE', 'LOCAL_FOLDER') NOT NULL,
    `status` ENUM('PENDING', 'QUEUED', 'DOWNLOADING', 'PAUSED', 'READY', 'SCANNED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `infoHash` VARCHAR(40) NULL,
    `downloadUrl` TEXT NULL,
    `releaseTitle` TEXT NULL,
    `downloadPath` VARCHAR(500) NULL,
    `seasonId` INTEGER NULL,
    `episodeId` INTEGER NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `media_sources_infoHash_key`(`infoHash`),
    INDEX `media_sources_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `source_files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mediaSourceId` INTEGER NOT NULL,
    `filePath` VARCHAR(500) NOT NULL,
    `fileName` VARCHAR(500) NOT NULL,
    `size` BIGINT NULL,
    `parsedSeason` INTEGER NULL,
    `parsedEpisode` INTEGER NULL,
    `status` ENUM('MATCHED', 'UNMATCHED', 'IGNORED') NOT NULL DEFAULT 'UNMATCHED',
    `reason` VARCHAR(500) NULL,
    `movieId` INTEGER NULL,
    `episodeId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `source_files_status_idx`(`status`),
    INDEX `source_files_movieId_idx`(`movieId`),
    INDEX `source_files_episodeId_idx`(`episodeId`),
    UNIQUE INDEX `source_files_mediaSourceId_filePath_key`(`mediaSourceId`, `filePath`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `process_jobs_sourceFileId_key` ON `process_jobs`(`sourceFileId`);

-- CreateIndex
CREATE INDEX `process_jobs_status_idx` ON `process_jobs`(`status`);

-- CreateIndex
CREATE UNIQUE INDEX `movies_mediaSourceId_key` ON `movies`(`mediaSourceId`);

-- AddForeignKey
ALTER TABLE `media_sources` ADD CONSTRAINT `media_sources_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `seasons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `media_sources` ADD CONSTRAINT `media_sources_episodeId_fkey` FOREIGN KEY (`episodeId`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_files` ADD CONSTRAINT `source_files_mediaSourceId_fkey` FOREIGN KEY (`mediaSourceId`) REFERENCES `media_sources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_files` ADD CONSTRAINT `source_files_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `movies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `source_files` ADD CONSTRAINT `source_files_episodeId_fkey` FOREIGN KEY (`episodeId`) REFERENCES `episodes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_jobs` ADD CONSTRAINT `process_jobs_sourceFileId_fkey` FOREIGN KEY (`sourceFileId`) REFERENCES `source_files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `movies` ADD CONSTRAINT `movies_mediaSourceId_fkey` FOREIGN KEY (`mediaSourceId`) REFERENCES `media_sources`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

