/*
  Warnings:

  - You are about to drop the column `airDate` on the `episodes` table. All the data in the column will be lost.
  - You are about to drop the column `airDate` on the `seasons` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `shows` table. All the data in the column will be lost.

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
    "downloaded" BOOLEAN NOT NULL DEFAULT false,
    "filePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "episodes_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_episodes" ("createdAt", "downloaded", "episodeNumber", "filePath", "id", "seasonId", "title", "updatedAt") SELECT "createdAt", "downloaded", "episodeNumber", "filePath", "id", "seasonId", "title", "updatedAt" FROM "episodes";
DROP TABLE "episodes";
ALTER TABLE "new_episodes" RENAME TO "episodes";
CREATE UNIQUE INDEX "episodes_seasonId_episodeNumber_key" ON "episodes"("seasonId", "episodeNumber");
CREATE TABLE "new_seasons" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "showId" INTEGER NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "releaseDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "seasons_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_seasons" ("createdAt", "id", "seasonNumber", "showId", "updatedAt") SELECT "createdAt", "id", "seasonNumber", "showId", "updatedAt" FROM "seasons";
DROP TABLE "seasons";
ALTER TABLE "new_seasons" RENAME TO "seasons";
CREATE UNIQUE INDEX "seasons_showId_seasonNumber_key" ON "seasons"("showId", "seasonNumber");
CREATE TABLE "new_shows" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "overview" TEXT,
    "posterUrl" TEXT,
    "status" TEXT,
    "originalLanguage" TEXT NOT NULL,
    "releaseDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_shows" ("createdAt", "id", "originalLanguage", "posterUrl", "releaseDate", "status", "title", "tmdbId", "updatedAt") SELECT "createdAt", "id", "originalLanguage", "posterUrl", "releaseDate", "status", "title", "tmdbId", "updatedAt" FROM "shows";
DROP TABLE "shows";
ALTER TABLE "new_shows" RENAME TO "shows";
CREATE UNIQUE INDEX "shows_tmdbId_key" ON "shows"("tmdbId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
