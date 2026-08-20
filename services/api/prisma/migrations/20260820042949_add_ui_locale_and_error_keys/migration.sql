-- AlterTable
ALTER TABLE `media_sources` ADD COLUMN `errorKey` VARCHAR(100) NULL,
    ADD COLUMN `errorParams` TEXT NULL;

-- AlterTable
ALTER TABLE `process_jobs` ADD COLUMN `errorKey` VARCHAR(100) NULL,
    ADD COLUMN `errorParams` TEXT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `uiLocale` VARCHAR(35) NULL;
