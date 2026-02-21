-- CreateTable
CREATE TABLE "languages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "iso2" TEXT NOT NULL,
    "iso3" TEXT NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_tmdb_results" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "media_type" TEXT NOT NULL,
    "adult" BOOLEAN,
    "backdrop_path" TEXT,
    "original_language" TEXT,
    "overview" TEXT,
    "popularity" REAL,
    "poster_path" TEXT,
    "vote_average" REAL,
    "vote_count" INTEGER,
    "original_title" TEXT,
    "release_date" TEXT,
    "title" TEXT,
    "video" BOOLEAN,
    "original_name" TEXT,
    "first_air_date" TEXT,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tmdb_results_original_language_fkey" FOREIGN KEY ("original_language") REFERENCES "languages" ("iso2") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_tmdb_results" ("adult", "backdrop_path", "createdAt", "first_air_date", "id", "media_type", "name", "original_language", "original_name", "original_title", "overview", "popularity", "poster_path", "release_date", "title", "tmdbId", "updatedAt", "video", "vote_average", "vote_count") SELECT "adult", "backdrop_path", "createdAt", "first_air_date", "id", "media_type", "name", "original_language", "original_name", "original_title", "overview", "popularity", "poster_path", "release_date", "title", "tmdbId", "updatedAt", "video", "vote_average", "vote_count" FROM "tmdb_results";
DROP TABLE "tmdb_results";
ALTER TABLE "new_tmdb_results" RENAME TO "tmdb_results";
CREATE UNIQUE INDEX "tmdb_results_tmdbId_key" ON "tmdb_results"("tmdbId");
CREATE UNIQUE INDEX "tmdb_results_tmdbId_media_type_key" ON "tmdb_results"("tmdbId", "media_type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "languages_iso2_key" ON "languages"("iso2");
