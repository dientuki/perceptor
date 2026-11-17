-- AlterTable
ALTER TABLE `subtitle_embeds` ADD COLUMN `replaceLanguages` JSON NULL;

-- AlterTable
ALTER TABLE `subtitle_searches` ADD COLUMN `replaceLanguages` JSON NULL;
