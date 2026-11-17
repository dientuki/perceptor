-- AlterTable
ALTER TABLE `subtitle_search_attempts` ADD COLUMN `variantTag` VARCHAR(10) NULL;

-- AlterTable
ALTER TABLE `subtitle_searches` ADD COLUMN `wantedVariants` JSON NULL;
