export const PROCESS_QUEUE = 'process';
export const SOURCE_READY_JOB = 'source-ready';

export type SourceReadyJob = {
  mediaSourceId: number;
};

export const ENCODE_QUEUE = 'encode';
export const ENCODE_JOB = 'encode';

export type EncodeJob = {
  processJobId: number;
};

// Redis pub/sub channel, not a queue — a cancellation is only meaningful to a worker
// running the job right now and must never be persisted for one to pick up later.
export const ENCODE_CANCEL_CHANNEL = 'encode:cancel';

export type EncodeCancelMessage = {
  processJobId: number;
};

// Spec 101, REQ-10
export const SUBTITLE_EMBED_QUEUE = 'subtitle-embed';
export const SUBTITLE_EMBED_JOB = 'subtitle-embed';

export type SubtitleEmbedJob = {
  subtitleEmbedId: number;
};

// Spec 103, REQ-10
export const SUBTITLE_SYNC_QUEUE = 'subtitle-sync';
export const SUBTITLE_SYNC_JOB = 'subtitle-sync';

export type SubtitleSyncJob = {
  subtitleSyncId: number;
};

// Spec 107, T005
export const SUBTITLE_PROBE_QUEUE = 'subtitle-probe';
export const SUBTITLE_PROBE_JOB = 'subtitle-probe';

export type SubtitleProbeJob = {
  subtitleSearchId: number;
};

// Spec 108, T003
export const LIBRARY_PROBE_QUEUE = 'library-probe';
export const LIBRARY_PROBE_JOB = 'library-probe';

export type LibraryProbeJob = {
  movieId?: number;
  episodeId?: number;
};

// Spec 113, T005
export const SUBTITLE_EMBED_SYNC_JOB = 'subtitle-embed-sync';

export type SubtitleEmbedSyncJob = {
  subtitleEmbedId: number;
  fileName: string;
};
