/*
  Warnings:

  - You are about to drop the column `status` on the `jobs` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "infoHash" TEXT,
    "downloadStatus" TEXT NOT NULL DEFAULT 'CREATED',
    "encodeStatus" TEXT NOT NULL DEFAULT 'WAITING',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_jobs" ("createdAt", "id", "infoHash", "tmdbId", "updatedAt") SELECT "createdAt", "id", "infoHash", "tmdbId", "updatedAt" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
