-- AlterTable
ALTER TABLE `user_movies` MODIFY `autoAcquire` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user_shows` MODIFY `autoAcquire` BOOLEAN NOT NULL DEFAULT false;
