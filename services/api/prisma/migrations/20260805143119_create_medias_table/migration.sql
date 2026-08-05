-- CreateTable
CREATE TABLE `download_tasks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `infoHash` VARCHAR(191) NULL,
    `downloadPath` VARCHAR(191) NULL,
    `status` ENUM('CREATED', 'SEARCHING', 'ADDED', 'DOWNLOADING', 'PAUSED', 'COMPLETED', 'ERROR') NOT NULL DEFAULT 'CREATED',
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `download_tasks_infoHash_key`(`infoHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `process_jobs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `downloadTaskId` INTEGER NOT NULL,
    `movieId` INTEGER NULL,
    `episodeId` INTEGER NULL,
    `inputFilePath` VARCHAR(191) NULL,
    `outputFilePath` VARCHAR(191) NULL,
    `ffmpegCommand` VARCHAR(191) NULL,
    `status` ENUM('WAITING', 'QUEUED', 'ENCODING', 'COMPLETED', 'ERROR') NOT NULL DEFAULT 'WAITING',
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `movies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tmdbId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `overview` VARCHAR(191) NULL,
    `posterUrl` VARCHAR(191) NULL,
    `releaseDate` DATETIME(3) NULL,
    `originalLanguage` VARCHAR(191) NOT NULL,
    `isLiveAction` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('MISSING', 'DOWNLOADING', 'ENCODING', 'COMPLETED', 'ERROR') NOT NULL DEFAULT 'MISSING',
    `filePath` VARCHAR(191) NULL,
    `downloadTaskId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `movies_tmdbId_key`(`tmdbId`),
    UNIQUE INDEX `movies_downloadTaskId_key`(`downloadTaskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shows` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tmdbId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `overview` VARCHAR(191) NULL,
    `posterUrl` VARCHAR(191) NULL,
    `status` VARCHAR(191) NULL,
    `isLiveAction` BOOLEAN NOT NULL DEFAULT true,
    `originalLanguage` VARCHAR(191) NOT NULL,
    `releaseDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shows_tmdbId_key`(`tmdbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seasons` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `showId` INTEGER NOT NULL,
    `seasonNumber` INTEGER NOT NULL,
    `releaseDate` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seasons_showId_seasonNumber_key`(`showId`, `seasonNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `episodes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `seasonId` INTEGER NOT NULL,
    `episodeNumber` INTEGER NOT NULL,
    `title` VARCHAR(191) NULL,
    `overview` VARCHAR(191) NULL,
    `releaseDate` DATETIME(3) NULL,
    `status` ENUM('MISSING', 'DOWNLOADING', 'ENCODING', 'COMPLETED', 'ERROR') NOT NULL DEFAULT 'MISSING',
    `filePath` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `episodes_seasonId_episodeNumber_key`(`seasonId`, `episodeNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `process_jobs` ADD CONSTRAINT `process_jobs_downloadTaskId_fkey` FOREIGN KEY (`downloadTaskId`) REFERENCES `download_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_jobs` ADD CONSTRAINT `process_jobs_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `movies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_jobs` ADD CONSTRAINT `process_jobs_episodeId_fkey` FOREIGN KEY (`episodeId`) REFERENCES `episodes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `movies` ADD CONSTRAINT `movies_downloadTaskId_fkey` FOREIGN KEY (`downloadTaskId`) REFERENCES `download_tasks`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seasons` ADD CONSTRAINT `seasons_showId_fkey` FOREIGN KEY (`showId`) REFERENCES `shows`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `episodes` ADD CONSTRAINT `episodes_seasonId_fkey` FOREIGN KEY (`seasonId`) REFERENCES `seasons`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
