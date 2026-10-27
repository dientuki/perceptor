-- AlterTable
ALTER TABLE `episodes` ADD COLUMN `fileAudioLanguages` JSON NULL,
    ADD COLUMN `fileSubtitleLanguages` JSON NULL,
    ADD COLUMN `tracksReadAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `movies` ADD COLUMN `fileAudioLanguages` JSON NULL,
    ADD COLUMN `fileSubtitleLanguages` JSON NULL,
    ADD COLUMN `tracksReadAt` DATETIME(3) NULL;
