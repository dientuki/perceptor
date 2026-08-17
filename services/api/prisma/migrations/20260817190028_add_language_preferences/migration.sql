-- CreateTable
CREATE TABLE `user_languages` (
    `userId` VARCHAR(191) NOT NULL,
    `languageId` INTEGER NOT NULL,

    INDEX `user_languages_languageId_idx`(`languageId`),
    PRIMARY KEY (`userId`, `languageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_movie_languages` (
    `userId` VARCHAR(191) NOT NULL,
    `movieId` INTEGER NOT NULL,
    `languageId` INTEGER NOT NULL,

    INDEX `user_movie_languages_languageId_idx`(`languageId`),
    PRIMARY KEY (`userId`, `movieId`, `languageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_show_languages` (
    `userId` VARCHAR(191) NOT NULL,
    `showId` INTEGER NOT NULL,
    `languageId` INTEGER NOT NULL,

    INDEX `user_show_languages_languageId_idx`(`languageId`),
    PRIMARY KEY (`userId`, `showId`, `languageId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_languages` ADD CONSTRAINT `user_languages_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_languages` ADD CONSTRAINT `user_languages_languageId_fkey` FOREIGN KEY (`languageId`) REFERENCES `languages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_movie_languages` ADD CONSTRAINT `user_movie_languages_userId_movieId_fkey` FOREIGN KEY (`userId`, `movieId`) REFERENCES `user_movies`(`userId`, `movieId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_movie_languages` ADD CONSTRAINT `user_movie_languages_languageId_fkey` FOREIGN KEY (`languageId`) REFERENCES `languages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_show_languages` ADD CONSTRAINT `user_show_languages_userId_showId_fkey` FOREIGN KEY (`userId`, `showId`) REFERENCES `user_shows`(`userId`, `showId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_show_languages` ADD CONSTRAINT `user_show_languages_languageId_fkey` FOREIGN KEY (`languageId`) REFERENCES `languages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
