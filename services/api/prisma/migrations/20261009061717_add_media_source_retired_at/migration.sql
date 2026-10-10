-- AlterTable
ALTER TABLE `media_sources` ADD COLUMN `retiredAt` DATETIME(3) NULL;

-- Spec 090, NFR-1: a row already written ERROR / error.source.replaced by the pre-feature
-- demotion is corrected to SCANNED + retiredAt only when it is "delivered" by 087's exact test
-- (isDeliveredSource): at least one COMPLETED ProcessJob reached through its SourceFile, and
-- none still WAITING/QUEUED/ENCODING. Every other error.source.replaced row (a race loser or a
-- source replaced mid-encode) is left byte-for-byte untouched, per REQ-4.
UPDATE `media_sources` AS `ms`
SET
  `status` = 'SCANNED',
  `retiredAt` = `ms`.`updatedAt`,
  `errorKey` = NULL,
  `errorMessage` = NULL,
  `errorParams` = NULL
WHERE
  `ms`.`status` = 'ERROR'
  AND `ms`.`errorKey` = 'error.source.replaced'
  AND EXISTS (
    SELECT 1
    FROM `process_jobs` AS `pj`
    INNER JOIN `source_files` AS `sf` ON `sf`.`id` = `pj`.`sourceFileId`
    WHERE `sf`.`mediaSourceId` = `ms`.`id` AND `pj`.`status` = 'COMPLETED'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `process_jobs` AS `pj`
    INNER JOIN `source_files` AS `sf` ON `sf`.`id` = `pj`.`sourceFileId`
    WHERE `sf`.`mediaSourceId` = `ms`.`id` AND `pj`.`status` IN ('WAITING', 'QUEUED', 'ENCODING')
  );
