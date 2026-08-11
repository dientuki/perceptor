-- AlterTable
ALTER TABLE `users` ADD COLUMN `isAdmin` BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark the oldest user (by createdAt) as administrator so an
-- existing install does not lose its admin (NFR-1). MariaDB refuses a
-- subquery that reads and writes the same table directly, hence the
-- derived-table wrapper.
UPDATE `users` SET `isAdmin` = true
 WHERE `id` = (SELECT `id` FROM (SELECT `id` FROM `users` ORDER BY `createdAt` ASC LIMIT 1) AS t);
