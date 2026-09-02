/*
  Warnings:

  - The primary key for the `user_movie_languages` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `user_show_languages` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE `user_movie_languages` DROP PRIMARY KEY,
    ADD COLUMN `kind` ENUM('AUDIO', 'SUBTITLE') NOT NULL DEFAULT 'AUDIO',
    ADD PRIMARY KEY (`userId`, `movieId`, `languageId`, `kind`);

-- AlterTable
ALTER TABLE `user_movies` ADD COLUMN `audioMandatory` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user_show_languages` DROP PRIMARY KEY,
    ADD COLUMN `kind` ENUM('AUDIO', 'SUBTITLE') NOT NULL DEFAULT 'AUDIO',
    ADD PRIMARY KEY (`userId`, `showId`, `languageId`, `kind`);

-- AlterTable
ALTER TABLE `user_shows` ADD COLUMN `audioMandatory` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `audioMandatory` BOOLEAN NOT NULL DEFAULT false;
