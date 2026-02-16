-- CreateTable
CREATE TABLE "TmdbResult" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TmdbResult_tmdbId_media_type_key" ON "TmdbResult"("tmdbId", "media_type");
