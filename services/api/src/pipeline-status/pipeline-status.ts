import { EncodeStatus, MediaStatus, SourceStatus } from '@prisma/client';

/**
 * The one normalized vocabulary every status a consumer reads must reduce to (REQ-1/REQ-2).
 * A plain, dependency-free module by design: no Nest, no Prisma client, no injection — every
 * input here is a plain row, so this is testable without a database.
 */
export const PIPELINE_STATUSES = [
  'MISSING',
  'QUEUED',
  'PAUSED',
  'DOWNLOADING',
  'DOWNLOADED',
  'ENCODING',
  'COMPLETED',
  'ERROR',
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/**
 * REQ-4's rank ladder. `ERROR` is deliberately absent — it never participates in a "most
 * advanced of" comparison, it always wins outright wherever it is checked.
 */
const RANK: Record<Exclude<PipelineStatus, 'ERROR'>, number> = {
  MISSING: 0,
  QUEUED: 1,
  PAUSED: 2,
  DOWNLOADING: 3,
  DOWNLOADED: 4,
  ENCODING: 5,
  COMPLETED: 6,
};

function maxStatus(
  a: Exclude<PipelineStatus, 'ERROR'>,
  b: Exclude<PipelineStatus, 'ERROR'>,
): Exclude<PipelineStatus, 'ERROR'> {
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * `SourceStatus` -> the eight-value vocabulary. `PENDING`/`QUEUED` collapse to `QUEUED`;
 * `READY`/`SCANNED` collapse to `DOWNLOADED`; everything else already spells the same word.
 */
export function translateSourceStatus(status: SourceStatus): PipelineStatus {
  switch (status) {
    case 'PENDING':
    case 'QUEUED':
      return 'QUEUED';
    case 'READY':
    case 'SCANNED':
      return 'DOWNLOADED';
    case 'DOWNLOADING':
      return 'DOWNLOADING';
    case 'PAUSED':
      return 'PAUSED';
    case 'ERROR':
      return 'ERROR';
  }
}

/**
 * `MediaStatus` is already a subset of the eight values (spec.md's "MediaStatus is a subset of
 * the eight"). Identity in behaviour, kept as a named function so both translations are called
 * the same way at every call site and neither is a silent cast scattered around the codebase.
 */
export function translateMediaStatus(status: MediaStatus): PipelineStatus {
  return status;
}

export type SourceAltitudeJob = {
  status: EncodeStatus;
  progress: number; // 0..100, as stored on ProcessJob
  encodeSpeed: number | null; // FFmpeg's realtime multiplier, as stored on ProcessJob
};

export type LiveTorrentReading = {
  state: SourceStatus;
  progress: number; // 0..1, exactly as qBittorrent reports it — never pre-multiplied
};

export type SourceAltitudeInput = {
  sourceStatus: SourceStatus;
  jobs: SourceAltitudeJob[];
  live?: LiveTorrentReading | null;
};

export type DerivedProgress = {
  status: PipelineStatus;
  downloadProgress: number | null; // 0..100 or null
  encodeProgress: number | null; // 0..100 or null
  encodeSpeed: number | null; // FFmpeg's realtime multiplier, non-null only from Rule 3 (REQ-10)
};

const ACTIVE_ENCODE_STATUSES: EncodeStatus[] = ['WAITING', 'QUEUED', 'ENCODING'];

function meanProgress(jobs: SourceAltitudeJob[]): number {
  const sum = jobs.reduce((acc, job) => acc + job.progress, 0);
  return Math.round(sum / jobs.length);
}

// Rule 3 only (REQ-10): the mean of the non-null speeds of jobs *currently* ENCODING — a
// WAITING/QUEUED job is not running and has nothing to report, and a COMPLETED/ERROR job's
// stored value is stale by construction. Null when no job is actively encoding.
function meanEncodeSpeed(jobs: SourceAltitudeJob[]): number | null {
  const running = jobs.filter(
    (job): job is SourceAltitudeJob & { encodeSpeed: number } =>
      job.status === 'ENCODING' && job.encodeSpeed !== null,
  );
  if (running.length === 0) {
    return null;
  }
  const sum = running.reduce((acc, job) => acc + job.encodeSpeed, 0);
  return sum / running.length;
}

// The only place the 0..1 -> 0..100 conversion happens (REQ-3). The adapter boundary
// (clients/torrent) keeps 0..1; nothing downstream of this function should multiply again.
function liveProgressToPercent(live: LiveTorrentReading): number {
  return Math.round(live.progress * 100);
}

/**
 * Source-altitude derivation (REQ-3): given one `MediaSource`, its `ProcessJob` rows and
 * optionally a live torrent reading for its `infoHash`, decide the normalized status and the
 * two progress numbers. The six rules run as **ordered early returns** — the order is the
 * specification, not an implementation detail. Do not reorder or collapse them into a switch.
 */
export function deriveSourceStatus(input: SourceAltitudeInput): DerivedProgress {
  const { sourceStatus, jobs, live } = input;

  // Rule 1: source is ERROR, or any job is ERROR.
  if (sourceStatus === 'ERROR' || jobs.some((job) => job.status === 'ERROR')) {
    return {
      status: 'ERROR',
      downloadProgress: live ? liveProgressToPercent(live) : null,
      encodeProgress: jobs.length > 0 ? meanProgress(jobs) : null,
      encodeSpeed: null,
    };
  }

  // Rule 2: jobs exist and every one is COMPLETED.
  if (jobs.length > 0 && jobs.every((job) => job.status === 'COMPLETED')) {
    return { status: 'COMPLETED', downloadProgress: 100, encodeProgress: 100, encodeSpeed: null };
  }

  // Rule 3: jobs exist, some WAITING/QUEUED/ENCODING.
  if (jobs.length > 0 && jobs.some((job) => ACTIVE_ENCODE_STATUSES.includes(job.status))) {
    return {
      status: 'ENCODING',
      downloadProgress: 100,
      encodeProgress: meanProgress(jobs),
      encodeSpeed: meanEncodeSpeed(jobs),
    };
  }

  // Rule 4: no jobs, source is READY or SCANNED.
  if (jobs.length === 0 && (sourceStatus === 'READY' || sourceStatus === 'SCANNED')) {
    return { status: 'DOWNLOADED', downloadProgress: 100, encodeProgress: null, encodeSpeed: null };
  }

  // Rule 5: no jobs, a live torrent reading exists.
  if (jobs.length === 0 && live) {
    return {
      status: translateSourceStatus(live.state),
      downloadProgress: liveProgressToPercent(live),
      encodeProgress: null,
      encodeSpeed: null,
    };
  }

  // Rule 6: otherwise — the source column, translated, no live data behind it.
  return {
    status: translateSourceStatus(sourceStatus),
    downloadProgress: null,
    encodeProgress: null,
    encodeSpeed: null,
  };
}

/**
 * Collapse of the eight-value vocabulary back to the five-value `MediaStatus` column
 * (`047-source-deletion` REQ-12). `QUEUED`/`PAUSED`/`DOWNLOADING`/`DOWNLOADED` all mean "some
 * source is still being acquired" from the title's perspective, so they collapse to
 * `DOWNLOADING`; the rest already spell the same word. Exhaustive `switch`, no `default` — a
 * future `PipelineStatus` member must fail to compile here, not silently fall through into a
 * column value nothing understands.
 */
export function toMediaStatus(status: PipelineStatus): MediaStatus {
  switch (status) {
    case 'QUEUED':
    case 'PAUSED':
    case 'DOWNLOADING':
    case 'DOWNLOADED':
      return 'DOWNLOADING';
    case 'MISSING':
    case 'ENCODING':
    case 'COMPLETED':
    case 'ERROR':
      return status;
  }
}

export type TitleAltitudeSource = {
  status: SourceStatus;
};

export type TitleAltitudeJob = {
  status: EncodeStatus;
};

export type TitleAltitudeInput = {
  status: MediaStatus;
  sources: TitleAltitudeSource[];
  jobs: TitleAltitudeJob[];
};

/**
 * Title-altitude derivation (REQ-4): `ERROR` if and only if the stored column is `ERROR`;
 * otherwise the maximum over the ladder of (a) the column, (b) each non-`ERROR` source's
 * translated status, and (c) the job set with `ERROR` jobs ignored. Reads only the database
 * (REQ-5, no live reading) and does not group jobs by source — `plan.md` § Approach decision 1
 * is explicit that `Movie.processJobs`/`Episode.processJobs` are denormalized precisely so this
 * join is unnecessary. Taking `ERROR` from the raw job set instead of the column would let a
 * superseded (demoted) source's failed job poison an otherwise-completed title — the AC-8 case.
 */
export function deriveTitleStatus(input: TitleAltitudeInput): PipelineStatus {
  const { status, sources, jobs } = input;

  if (status === 'ERROR') {
    return 'ERROR';
  }

  let best = translateMediaStatus(status) as Exclude<PipelineStatus, 'ERROR'>;

  for (const source of sources) {
    if (source.status === 'ERROR') {
      continue;
    }
    best = maxStatus(best, translateSourceStatus(source.status) as Exclude<PipelineStatus, 'ERROR'>);
  }

  const activeJobs = jobs.filter((job) => job.status !== 'ERROR');
  if (activeJobs.length > 0) {
    const allCompleted = activeJobs.every((job) => job.status === 'COMPLETED');
    best = maxStatus(best, allCompleted ? 'COMPLETED' : 'ENCODING');
  }

  return best;
}
