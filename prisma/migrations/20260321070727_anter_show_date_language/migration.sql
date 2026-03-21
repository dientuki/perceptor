/*
  Warnings:

  - Added the required column `originalLanguage` to the `shows` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shows" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "posterUrl" TEXT,
    "status" TEXT,
    "originalLanguage" TEXT NOT NULL,
    "releaseDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_shows" ("createdAt", "description", "id", "posterUrl", "status", "title", "tmdbId", "updatedAt") SELECT "createdAt", "description", "id", "posterUrl", "status", "title", "tmdbId", "updatedAt" FROM "shows";
DROP TABLE "shows";
ALTER TABLE "new_shows" RENAME TO "shows";
CREATE UNIQUE INDEX "shows_tmdbId_key" ON "shows"("tmdbId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
