-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "episodeId" INTEGER,
    "infoHash" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'MOVIE',
    "downloadStatus" TEXT NOT NULL DEFAULT 'CREATED',
    "encodeStatus" TEXT NOT NULL DEFAULT 'WAITING',
    "errorMessage" TEXT,
    "root_path" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_jobs" ("createdAt", "downloadStatus", "encodeStatus", "errorMessage", "id", "infoHash", "root_path", "tmdbId", "updatedAt") SELECT "createdAt", "downloadStatus", "encodeStatus", "errorMessage", "id", "infoHash", "root_path", "tmdbId", "updatedAt" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
CREATE UNIQUE INDEX "jobs_tmdbId_key" ON "jobs"("tmdbId");
CREATE UNIQUE INDEX "jobs_episodeId_key" ON "jobs"("episodeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
