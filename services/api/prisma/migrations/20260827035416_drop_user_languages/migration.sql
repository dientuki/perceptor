/*
  Warnings:

  - You are about to drop the `user_languages` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `user_languages` DROP FOREIGN KEY `user_languages_languageId_fkey`;

-- DropForeignKey
ALTER TABLE `user_languages` DROP FOREIGN KEY `user_languages_userId_fkey`;

-- DropTable
DROP TABLE `user_languages`;
