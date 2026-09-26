-- AlterTable
ALTER TABLE `users` ADD COLUMN `acquireDigital` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `acquirePhysical` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `acquireTheatrical` BOOLEAN NOT NULL DEFAULT false;
