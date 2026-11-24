-- AlterTable
ALTER TABLE `movies` ADD COLUMN `imdbId` VARCHAR(20) NULL,
    ADD COLUMN `imdbIdCheckedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `shows` ADD COLUMN `imdbId` VARCHAR(20) NULL,
    ADD COLUMN `imdbIdCheckedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `subtitle_search_attempts` ADD COLUMN `provider` ENUM('OPENSUBTITLES', 'SUBDIVX') NOT NULL DEFAULT 'OPENSUBTITLES';

-- AlterTable
ALTER TABLE `subtitle_searches` ADD COLUMN `providerProgress` JSON NULL;
