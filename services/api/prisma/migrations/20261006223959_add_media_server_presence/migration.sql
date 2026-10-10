-- AlterTable
ALTER TABLE `episodes` ADD COLUMN `mediaServerPresentAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `movies` ADD COLUMN `mediaServerPresentAt` DATETIME(3) NULL;

-- Spec 089, REQ-4/NFR-3: backfill mediaServerPresentAt for every row reachable only through
-- reconciliation. filePath is written in exactly one place (process-jobs.service.ts:307) and
-- always together with COMPLETED, so a row at COMPLETED with a null filePath got there solely
-- because the configured media server was observed holding it.
update movies   set mediaServerPresentAt = now() where status = 'COMPLETED' and filePath is null;
update episodes set mediaServerPresentAt = now() where status = 'COMPLETED' and filePath is null;
