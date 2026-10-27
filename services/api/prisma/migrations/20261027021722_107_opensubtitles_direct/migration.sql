-- Spec 107: the search no longer waits on Jellyfin. Columns are added first, the two data
-- steps run while WAITING/SEARCHING rows are still identifiable, and the drops come last.
-- The drops are not reversible (itemId/checkCount are Jellyfin-wait state); roll back by
-- restoring the pre-migration backup.

-- AlterTable: add
ALTER TABLE `subtitle_searches`
    ADD COLUMN `fileSizeBytes` BIGINT NULL,
    ADD COLUMN `languageErrors` JSON NULL,
    ADD COLUMN `movieHash` VARCHAR(16) NULL,
    ADD COLUMN `probeCount` INTEGER NOT NULL DEFAULT 0;

-- Data: searches that were still waiting on Jellyfin are superseded.
UPDATE `subtitle_searches`
    SET `status` = 'FAILED', `errorKey` = 'error.subtitleSearch.superseded', `finishedAt` = NOW()
    WHERE `status` IN ('WAITING', 'SEARCHING');

-- Data: queued attempts whose id is a Jellyfin id must never reach the new provider.
UPDATE `subtitle_search_attempts` a
    JOIN `subtitle_searches` s ON s.`id` = a.`searchId`
    SET a.`status` = 'FAILED', a.`reasonKey` = 'error.subtitleSearch.superseded', a.`finishedAt` = NOW()
    WHERE s.`status` = 'VALIDATING' AND a.`status` = 'QUEUED' AND a.`stagedPath` IS NULL;

-- AlterTable: drop
ALTER TABLE `subtitle_searches`
    DROP COLUMN `checkCount`,
    DROP COLUMN `itemId`;
