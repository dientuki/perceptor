-- AlterTable
ALTER TABLE `shows` ADD COLUMN `fileAudioLanguages` JSON NULL,
    ADD COLUMN `fileSubtitleLanguages` JSON NULL;
