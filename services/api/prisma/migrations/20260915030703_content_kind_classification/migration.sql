-- AlterTable
ALTER TABLE `movies` DROP COLUMN `isLiveAction`,
    ADD COLUMN `contentKind` ENUM('LIVE_ACTION', 'ANIME', 'CGI') NOT NULL DEFAULT 'LIVE_ACTION';

-- AlterTable
ALTER TABLE `shows` DROP COLUMN `isLiveAction`,
    ADD COLUMN `contentKind` ENUM('LIVE_ACTION', 'ANIME', 'CGI') NOT NULL DEFAULT 'LIVE_ACTION';
