/*
  Warnings:

  - Made the column `status` on table `shows` required. This step will fail if there are existing NULL values in that column.

*/
-- Backfill: nothing has ever written `shows`.`status`, so every existing row is NULL.
-- This must run while the column is still a nullable varchar; the MODIFY below would
-- otherwise fail on those rows (or silently coerce them under a non-strict SQL mode).
UPDATE `shows` SET `status` = 'MISSING' WHERE `status` IS NULL;

-- AlterTable
ALTER TABLE `shows` MODIFY `status` ENUM('MISSING', 'DOWNLOADING', 'ENCODING', 'COMPLETED', 'ERROR') NOT NULL DEFAULT 'MISSING';
