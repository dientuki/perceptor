/*
  Warnings:

  - You are about to drop the column `downloaded` on the `episodes` table. All the data in the column will be lost.
  - You are about to drop the column `originalTitle` on the `movies` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[movieId]` on the table `jobs` will be added. If there are existing duplicate values, this will fail.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_episodes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "title" TEXT,
    "overview" TEXT,
    "releaseDate" DATETIME,
    "filePath" TEXT,
    "jobStatus" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "episodes_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_episodes" ("createdAt", "episodeNumber", "filePath", "id", "overview", "releaseDate", "seasonId", "title", "updatedAt") SELECT "createdAt", "episodeNumber", "filePath", "id", "overview", "releaseDate", "seasonId", "title", "updatedAt" FROM "episodes";
DROP TABLE "episodes";
ALTER TABLE "new_episodes" RENAME TO "episodes";
CREATE UNIQUE INDEX "episodes_seasonId_episodeNumber_key" ON "episodes"("seasonId", "episodeNumber");
CREATE TABLE "new_movies" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "overview" TEXT,
    "posterUrl" TEXT,
    "status" TEXT,
    "releaseDate" DATETIME,
    "originalLanguage" TEXT NOT NULL,
    "isLiveAction" BOOLEAN NOT NULL DEFAULT true,
    "jobStatus" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_movies" ("createdAt", "id", "isLiveAction", "originalLanguage", "overview", "posterUrl", "releaseDate", "status", "title", "tmdbId", "updatedAt") SELECT "createdAt", "id", "isLiveAction", "originalLanguage", "overview", "posterUrl", "releaseDate", "status", "title", "tmdbId", "updatedAt" FROM "movies";
DROP TABLE "movies";
ALTER TABLE "new_movies" RENAME TO "movies";
CREATE UNIQUE INDEX "movies_tmdbId_key" ON "movies"("tmdbId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "jobs_movieId_key" ON "jobs"("movieId");
