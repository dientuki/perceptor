-- CreateTable
CREATE TABLE `user_movies` (
    `userId` VARCHAR(191) NOT NULL,
    `movieId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_movies_movieId_idx`(`movieId`),
    PRIMARY KEY (`userId`, `movieId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_movies` ADD CONSTRAINT `user_movies_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_movies` ADD CONSTRAINT `user_movies_movieId_fkey` FOREIGN KEY (`movieId`) REFERENCES `movies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (NFR-1): attach every pre-existing movie to the oldest enabled
-- administrator, resolved from the database rather than from `.env` — a
-- migration has no access to it and the username may have been renamed
-- since the seed ran. The EXISTS guard is load-bearing: without it, an
-- installation with no enabled admin would insert NULL into a non-null
-- foreign key and the migration would fail halfway; with it, that
-- installation ends up with an empty `user_movies` table instead.
INSERT INTO `user_movies` (`userId`, `movieId`, `createdAt`)
SELECT (SELECT `id` FROM `users`
         WHERE `isAdmin` = true AND `isEnabled` = true
         ORDER BY `createdAt` ASC LIMIT 1),
       `id`, NOW()
  FROM `movies`
 WHERE EXISTS (SELECT 1 FROM `users` WHERE `isAdmin` = true AND `isEnabled` = true);
