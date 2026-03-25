// src/models/jobs.types.ts
import { Prisma } from "@prisma/client";
import { DownloadStatus } from "@prisma/client";

export type JobStateUpdate = {
  id: number;
  downloadStatus: DownloadStatus;
  root_path: string;
};