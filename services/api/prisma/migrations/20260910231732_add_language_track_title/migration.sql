-- AlterTable
ALTER TABLE `languages` ADD COLUMN `trackTitle` VARCHAR(191) NULL;

-- Backfill: native-script track titles for the 20 base rows (REQ-2).
-- es-419 and es-ES are deliberately excluded (REQ-6) — their titles live in
-- the worker's variants.ts, coupled to the release-name markers that detect them.
UPDATE `languages` SET `trackTitle` = 'Español' WHERE `tag` = 'es';
UPDATE `languages` SET `trackTitle` = 'English' WHERE `tag` = 'en';
UPDATE `languages` SET `trackTitle` = 'Português' WHERE `tag` = 'pt';
UPDATE `languages` SET `trackTitle` = '日本語' WHERE `tag` = 'ja';
UPDATE `languages` SET `trackTitle` = '한국어' WHERE `tag` = 'ko';
UPDATE `languages` SET `trackTitle` = 'Français' WHERE `tag` = 'fr';
UPDATE `languages` SET `trackTitle` = 'Deutsch' WHERE `tag` = 'de';
UPDATE `languages` SET `trackTitle` = '中文' WHERE `tag` = 'zh';
UPDATE `languages` SET `trackTitle` = 'हिन्दी' WHERE `tag` = 'hi';
UPDATE `languages` SET `trackTitle` = 'Svenska' WHERE `tag` = 'sv';
UPDATE `languages` SET `trackTitle` = 'Nederlands' WHERE `tag` = 'nl';
UPDATE `languages` SET `trackTitle` = 'Norsk' WHERE `tag` = 'nb';
UPDATE `languages` SET `trackTitle` = 'Polski' WHERE `tag` = 'pl';
UPDATE `languages` SET `trackTitle` = 'Türkçe' WHERE `tag` = 'tr';
UPDATE `languages` SET `trackTitle` = 'ไทย' WHERE `tag` = 'th';
UPDATE `languages` SET `trackTitle` = 'Čeština' WHERE `tag` = 'cs';
UPDATE `languages` SET `trackTitle` = 'Italiano' WHERE `tag` = 'it';
UPDATE `languages` SET `trackTitle` = 'Русский' WHERE `tag` = 'ru';
UPDATE `languages` SET `trackTitle` = 'العربية' WHERE `tag` = 'ar';
UPDATE `languages` SET `trackTitle` = 'Dansk' WHERE `tag` = 'da';
