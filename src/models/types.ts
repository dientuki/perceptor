// src/models/jobs.types.ts
import { Prisma } from "@prisma/client";
import { DownloadStatus } from "@prisma/client";

export const jobToRipInclude = {
  tmdb: {
    include: {
      language: true,
    },
  },
} satisfies Prisma.JobInclude;

export type JobToRip = Prisma.JobGetPayload<{
  include: typeof jobToRipInclude;
}>;

export type JobReadyToRip = 
    JobToRip & 
    { 
        root_path: string,
        infoHash: string
        tmdb: {
            language: {
                iso3: string
            },
            original_title: string,
            release_date: string
        }
    };

export type JobStateUpdate = {
  id: number;
  downloadStatus: DownloadStatus;
  root_path: string;
};