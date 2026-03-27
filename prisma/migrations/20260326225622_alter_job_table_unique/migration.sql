/*
  Warnings:

  - A unique constraint covering the columns `[tmdbId,mediaType,episodeId]` on the table `jobs` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "jobs_tmdbId_mediaType_key";

-- CreateIndex
CREATE UNIQUE INDEX "jobs_tmdbId_mediaType_episodeId_key" ON "jobs"("tmdbId", "mediaType", "episodeId");
