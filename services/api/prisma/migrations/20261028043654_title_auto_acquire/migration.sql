-- AlterTable
ALTER TABLE `user_movies` ADD COLUMN `autoAcquire` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `user_shows` ADD COLUMN `autoAcquire` BOOLEAN NOT NULL DEFAULT true;
