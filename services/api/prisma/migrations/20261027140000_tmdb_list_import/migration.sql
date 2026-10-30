-- CreateTable
CREATE TABLE `user_tmdb_lists` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `tmdbListId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `lastImportedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `user_tmdb_lists_userId_tmdbListId_key`(`userId`, `tmdbListId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_tmdb_list_items` (
    `listId` INTEGER NOT NULL,
    `tmdbId` INTEGER NOT NULL,
    `mediaType` VARCHAR(5) NOT NULL,
    `seenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`listId`, `tmdbId`, `mediaType`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_tmdb_lists` ADD CONSTRAINT `user_tmdb_lists_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_tmdb_list_items` ADD CONSTRAINT `user_tmdb_list_items_listId_fkey` FOREIGN KEY (`listId`) REFERENCES `user_tmdb_lists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

