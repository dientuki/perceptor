-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "movieId" INTEGER,
    "episodeId" INTEGER,
    "seasonId" INTEGER,
    "infoHash" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'MOVIE',
    "downloadStatus" TEXT NOT NULL DEFAULT 'CREATED',
    "encodeStatus" TEXT NOT NULL DEFAULT 'WAITING',
    "ffmpegCommand" TEXT,
    "errorMessage" TEXT,
    "root_path" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "jobs_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_jobs" ("createdAt", "downloadStatus", "encodeStatus", "episodeId", "errorMessage", "ffmpegCommand", "id", "infoHash", "mediaType", "movieId", "root_path", "tmdbId", "updatedAt") SELECT "createdAt", "downloadStatus", "encodeStatus", "episodeId", "errorMessage", "ffmpegCommand", "id", "infoHash", "mediaType", "movieId", "root_path", "tmdbId", "updatedAt" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
CREATE UNIQUE INDEX "jobs_movieId_key" ON "jobs"("movieId");
CREATE UNIQUE INDEX "jobs_episodeId_key" ON "jobs"("episodeId");
CREATE UNIQUE INDEX "jobs_seasonId_key" ON "jobs"("seasonId");
CREATE UNIQUE INDEX "jobs_tmdbId_mediaType_episodeId_key" ON "jobs"("tmdbId", "mediaType", "episodeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
