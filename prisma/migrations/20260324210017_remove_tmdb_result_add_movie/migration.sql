/*
  Warnings:

  - You are about to drop the `tmdb_results` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "tmdb_results_tmdbId_media_type_key";

-- DropIndex
DROP INDEX "tmdb_results_tmdbId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "tmdb_results";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "movies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "overview" TEXT,
    "posterUrl" TEXT,
    "status" TEXT,
    "releaseDate" DATETIME,
    "originalLanguage" TEXT NOT NULL,
    "isLiveAction" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "movieId" INTEGER,
    "episodeId" INTEGER,
    "infoHash" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'MOVIE',
    "downloadStatus" TEXT NOT NULL DEFAULT 'CREATED',
    "encodeStatus" TEXT NOT NULL DEFAULT 'WAITING',
    "errorMessage" TEXT,
    "root_path" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "jobs_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "movies" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "jobs_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_jobs" ("createdAt", "downloadStatus", "encodeStatus", "episodeId", "errorMessage", "id", "infoHash", "mediaType", "root_path", "tmdbId", "updatedAt") SELECT "createdAt", "downloadStatus", "encodeStatus", "episodeId", "errorMessage", "id", "infoHash", "mediaType", "root_path", "tmdbId", "updatedAt" FROM "jobs";
DROP TABLE "jobs";
ALTER TABLE "new_jobs" RENAME TO "jobs";
CREATE UNIQUE INDEX "jobs_episodeId_key" ON "jobs"("episodeId");
CREATE UNIQUE INDEX "jobs_tmdbId_mediaType_key" ON "jobs"("tmdbId", "mediaType");
CREATE TABLE "new_shows" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "overview" TEXT,
    "posterUrl" TEXT,
    "status" TEXT,
    "isLiveAction" BOOLEAN NOT NULL DEFAULT true,
    "originalLanguage" TEXT NOT NULL,
    "releaseDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_shows" ("createdAt", "id", "originalLanguage", "overview", "posterUrl", "releaseDate", "status", "title", "tmdbId", "updatedAt") SELECT "createdAt", "id", "originalLanguage", "overview", "posterUrl", "releaseDate", "status", "title", "tmdbId", "updatedAt" FROM "shows";
DROP TABLE "shows";
ALTER TABLE "new_shows" RENAME TO "shows";
CREATE UNIQUE INDEX "shows_tmdbId_key" ON "shows"("tmdbId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "movies_tmdbId_key" ON "movies"("tmdbId");
