-- CreateTable
CREATE TABLE `scheduled_task_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `taskId` VARCHAR(100) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `outcome` ENUM('SUCCESS', 'FAILED', 'SKIPPED') NOT NULL,
    `itemsProcessed` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,

    INDEX `scheduled_task_runs_taskId_startedAt_idx`(`taskId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
