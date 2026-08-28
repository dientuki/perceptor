-- DropForeignKey
ALTER TABLE `movies` DROP FOREIGN KEY `movies_mediaSourceId_fkey`;

-- DropIndex
DROP INDEX `movies_mediaSourceId_key` ON `movies`;

-- AlterTable
ALTER TABLE `media_sources` ADD COLUMN `movieId` INTEGER NULL;

-- AlterTable
ALTER TABLE `movies` DROP COLUMN `mediaSourceId`;

-- CreateIndex
CREATE INDEX `media_sources_movieId_idx` ON `media_sources`(`movieId`);

-- AddForeignKey
ALTER TABLE `media_sources` ADD CONSTRAINT `media_sources_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `movies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

