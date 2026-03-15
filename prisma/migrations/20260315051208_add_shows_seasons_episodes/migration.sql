-- CreateTable
CREATE TABLE "shows" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "posterUrl" TEXT,
    "status" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "showId" INTEGER NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "airDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "seasons_showId_fkey" FOREIGN KEY ("showId") REFERENCES "shows" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "episodes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "seasonId" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "title" TEXT,
    "airDate" DATETIME,
    "downloaded" BOOLEAN NOT NULL DEFAULT false,
    "filePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "episodes_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "shows_tmdbId_key" ON "shows"("tmdbId");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_showId_seasonNumber_key" ON "seasons"("showId", "seasonNumber");

-- CreateIndex
CREATE UNIQUE INDEX "episodes_seasonId_episodeNumber_key" ON "episodes"("seasonId", "episodeNumber");
