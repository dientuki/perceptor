-- AlterTable
ALTER TABLE `shows` ADD COLUMN `seasonsSyncedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `user_shows` (
    `userId` VARCHAR(191) NOT NULL,
    `showId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_shows_showId_idx`(`showId`),
    PRIMARY KEY (`userId`, `showId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_shows` ADD CONSTRAINT `user_shows_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_shows` ADD CONSTRAINT `user_shows_showId_fkey` FOREIGN KEY (`showId`) REFERENCES `shows`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
