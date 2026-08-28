-- DropIndex
DROP INDEX `languages_iso2_key` ON `languages`;

-- AlterTable
ALTER TABLE `languages` ADD COLUMN `tag` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `languages_tag_key` ON `languages`(`tag`);
