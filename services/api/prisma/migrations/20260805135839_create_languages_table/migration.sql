-- CreateTable
CREATE TABLE `languages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `iso2` VARCHAR(191) NOT NULL,
    `iso3` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `languages_iso2_key`(`iso2`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
