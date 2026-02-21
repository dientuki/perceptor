/*
  Warnings:

  - A unique constraint covering the columns `[tmdbId]` on the table `tmdb_results` will be added. If there are existing duplicate values, this will fail.

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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_tmdbId_fkey" FOREIGN KEY ("tmdbId") REFERENCES "tmdb_results" ("tmdbId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_jobs" ("createdAt", "downloadStatus", "encodeStatus", "errorMessage", "id", "infoHash", "tmdbId", "updatedAt") SELECT "createdAt", "downloadStatus", "encodeStatus", "errorMessage", "id", "infoHash", "tmdbId", "updatedAt" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
CREATE UNIQUE INDEX "jobs_tmdbId_key" ON "jobs"("tmdbId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "tmdb_results_tmdbId_key" ON "tmdb_results"("tmdbId");
