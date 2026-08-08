-- DropIndex
DROP INDEX `source_files_status_idx` ON `source_files`;

-- AlterTable
ALTER TABLE `source_files` DROP COLUMN `fileName`,
    DROP COLUMN `parsedEpisode`,
    DROP COLUMN `parsedSeason`,
    DROP COLUMN `reason`,
    DROP COLUMN `size`,
    DROP COLUMN `status`;

