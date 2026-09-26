-- AlterTable
ALTER TABLE `movies` ADD COLUMN `catalogClosedAt` DATETIME(3) NULL,
    ADD COLUMN `digitalReleaseDate` DATETIME(3) NULL,
    ADD COLUMN `physicalReleaseDate` DATETIME(3) NULL,
    ADD COLUMN `theatricalReleaseDate` DATETIME(3) NULL,
    ADD COLUMN `tmdbStatus` VARCHAR(191) NULL;
