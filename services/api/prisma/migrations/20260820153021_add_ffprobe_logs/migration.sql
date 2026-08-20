-- CreateTable
CREATE TABLE `ffprobe_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `file` VARCHAR(500) NOT NULL,
    `ffprobe` MEDIUMTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ffprobe_logs_file_idx`(`file`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
