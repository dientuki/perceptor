-- AlterTable
ALTER TABLE `users` ADD COLUMN `allowCinemaReleases` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `user_language_preferences` (
    `userId` VARCHAR(191) NOT NULL,
    `languageId` INTEGER NOT NULL,
    `kind` ENUM('AUDIO', 'SUBTITLE') NOT NULL,

    INDEX `user_language_preferences_languageId_idx`(`languageId`),
    PRIMARY KEY (`userId`, `languageId`, `kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `torrent_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `scope` ENUM('MOVIE', 'SHOW') NOT NULL,

    UNIQUE INDEX `torrent_groups_name_scope_key`(`name`, `scope`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_torrent_groups` (
    `userId` VARCHAR(191) NOT NULL,
    `torrentGroupId` INTEGER NOT NULL,

    INDEX `user_torrent_groups_torrentGroupId_idx`(`torrentGroupId`),
    PRIMARY KEY (`userId`, `torrentGroupId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_language_preferences` ADD CONSTRAINT `user_language_preferences_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_language_preferences` ADD CONSTRAINT `user_language_preferences_languageId_fkey` FOREIGN KEY (`languageId`) REFERENCES `languages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_torrent_groups` ADD CONSTRAINT `user_torrent_groups_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_torrent_groups` ADD CONSTRAINT `user_torrent_groups_torrentGroupId_fkey` FOREIGN KEY (`torrentGroupId`) REFERENCES `torrent_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
