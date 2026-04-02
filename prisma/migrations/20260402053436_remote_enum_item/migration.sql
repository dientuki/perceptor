-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "jobStatus" TEXT DEFAULT 'CREATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_movies" ("createdAt", "id", "isLiveAction", "jobStatus", "originalLanguage", "overview", "posterUrl", "releaseDate", "status", "title", "tmdbId", "updatedAt") SELECT "createdAt", "id", "isLiveAction", "jobStatus", "originalLanguage", "overview", "posterUrl", "releaseDate", "status", "title", "tmdbId", "updatedAt" FROM "movies";
DROP TABLE "movies";
ALTER TABLE "new_movies" RENAME TO "movies";
CREATE UNIQUE INDEX "movies_tmdbId_key" ON "movies"("tmdbId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
