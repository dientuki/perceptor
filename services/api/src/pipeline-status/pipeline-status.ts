import { EncodeStatus, SourceStatus } from '@prisma/client';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { MESSAGES_EN } from '@/i18n/messages.en';

// Spec 043, REQ-1 REQ-2
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

// Spec 043, REQ-4
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
  status: PipelineStatus | 'DISCARDED';
  downloadProgress: number | null; // 0..100 or null
  encodeProgress: number | null; // 0..100 or null
  encodeSpeed: number | null; // Spec 053, REQ-10
};

export const ACTIVE_ENCODE_STATUSES: EncodeStatus[] = ['WAITING', 'QUEUED', 'ENCODING'];

// Spec 097, NFR-1
export const IN_FLIGHT_ENCODE_STATUSES: EncodeStatus[] = [...ACTIVE_ENCODE_STATUSES, 'STOPPED'];

// Spec 053, REQ-10
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

// Spec 043, REQ-3
function liveProgressToPercent(live: LiveTorrentReading): number {
  return Math.floor(live.progress * 100 + 1e-9);
}

// Spec 095, REQ-7
function countedProgress(counted: SourceAltitudeJob[]): number {
  const sum = counted.reduce((acc, job) => {
    if (job.status === 'COMPLETED') {
      return acc + 100;
    }
    // Spec 097, REQ-13
    if (job.status === 'ERROR' || job.status === 'STOPPED') {
      return acc;
    }
    return acc + job.progress;
  }, 0);
  return Math.floor(sum / counted.length);
}

// Spec 043, REQ-3; Spec 095, REQ-7 REQ-8 REQ-9
export function deriveSourceStatus(input: SourceAltitudeInput): DerivedProgress {
  const { sourceStatus, jobs, live } = input;
  const counted = jobs.filter((job) => job.status !== 'DISCARDED');

  // Rule 1: source is ERROR.
  if (sourceStatus === 'ERROR') {
    return {
      status: 'ERROR',
      downloadProgress: live ? liveProgressToPercent(live) : null,
      encodeProgress: counted.length > 0 ? countedProgress(counted) : null,
      encodeSpeed: null,
    };
  }

  // Rule 2: jobs exist and every one is DISCARDED.
  if (jobs.length > 0 && counted.length === 0) {
    return { status: 'DISCARDED', downloadProgress: null, encodeProgress: null, encodeSpeed: null };
  }

  // Rule 3: some job is WAITING/QUEUED/ENCODING, whatever the others ended as.
  if (counted.some((job) => ACTIVE_ENCODE_STATUSES.includes(job.status))) {
    return {
      status: 'ENCODING',
      downloadProgress: 100,
      encodeProgress: countedProgress(counted),
      encodeSpeed: meanEncodeSpeed(counted),
    };
  }

  // Rule 3b: no job is active and some job is ERROR.
  if (counted.some((job) => job.status === 'ERROR')) {
    return {
      status: 'ERROR',
      downloadProgress: live ? liveProgressToPercent(live) : null,
      encodeProgress: countedProgress(counted),
      encodeSpeed: null,
    };
  }

  // Spec 097, REQ-4
  if (counted.some((job) => job.status === 'STOPPED')) {
    return {
      status: 'PAUSED',
      downloadProgress: 100,
      encodeProgress: countedProgress(counted),
      encodeSpeed: null,
    };
  }

  // Rule 3c: jobs exist and every counted one is COMPLETED.
  if (counted.length > 0 && counted.every((job) => job.status === 'COMPLETED')) {
    return { status: 'COMPLETED', downloadProgress: 100, encodeProgress: 100, encodeSpeed: null };
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
 * Season-pack lift (`059-season-pack-acquisition-ui`): whether an episode still stored as
 * `MISSING`/etc. should read at least `QUEUED` because an unscanned season-pack source is in
 * flight for its season and the episode has already aired. A pack source is deliberately kept
 * lifting until it reaches `SCANNED` (matched) or `ERROR` (failed) — dropping either exclusion
 * would either stop lifting a still-downloading pack (an aired episode regresses to `MISSING`
 * mid-flight) or keep lifting forever after the pack finishes (an episode the pack never matched
 * never falls back to `MISSING`). An unaired episode is never lifted, regardless of the pack's
 * state — the pack cannot contain content for an episode that hasn't aired yet.
 */
export type SeasonPackLiftSource = {
  status: SourceStatus;
};

export function isLiftedBySeasonPack(
  sources: SeasonPackLiftSource[],
  releaseDate: Date | null,
  now: Date,
): boolean {
  if (releaseDate === null || releaseDate > now) {
    return false;
  }
  return sources.some((source) => source.status !== 'ERROR' && source.status !== 'SCANNED');
}

export type TitleAltitudeSource = {
  status: SourceStatus;
};

export type TitleAltitudeJob = {
  status: EncodeStatus;
};

export type TitleAltitudeInput = {
  filePath: string | null;
  mediaServerPresentAt: Date | null;
  sources: TitleAltitudeSource[];
  jobs: TitleAltitudeJob[];
};

export type PossessionInput = {
  filePath: string | null;
  mediaServerPresentAt: Date | null;
};

// Spec 089, REQ-16
export function hasPossession(row: PossessionInput): boolean {
  return row.filePath != null || row.mediaServerPresentAt != null;
}

// Spec 089, REQ-16
export const POSSESSION_WHERE = {
  OR: [{ filePath: { not: null } }, { mediaServerPresentAt: { not: null } }],
};

// Spec 089, REQ-2 REQ-3 REQ-4 REQ-15
export function deriveTitleStatus(input: TitleAltitudeInput): PipelineStatus {
  const { sources, jobs } = input;

  let best: Exclude<PipelineStatus, 'ERROR'> = 'MISSING';

  for (const source of sources) {
    if (source.status === 'ERROR' || source.status === 'SCANNED') {
      continue;
    }
    best = maxStatus(best, translateSourceStatus(source.status) as Exclude<PipelineStatus, 'ERROR'>);
  }

  if (jobs.some((job) => ACTIVE_ENCODE_STATUSES.includes(job.status))) {
    best = maxStatus(best, 'ENCODING');
  }

  // Spec 097, REQ-4
  if (jobs.some((job) => job.status === 'STOPPED')) {
    best = maxStatus(best, 'PAUSED');
  }

  if (hasPossession(input) && best === 'MISSING') {
    return 'COMPLETED';
  }

  return best;
}

export type EpisodeStatusInput = {
  filePath: string | null;
  mediaServerPresentAt: Date | null;
  releaseDate: Date | null;
  mediaSources: TitleAltitudeSource[];
  processJobs: TitleAltitudeJob[];
};

export function deriveEpisodeStatus(
  seasonSources: SeasonPackLiftSource[],
  episode: EpisodeStatusInput,
  now: Date,
): PipelineStatus {
  const lifted = isLiftedBySeasonPack(seasonSources, episode.releaseDate, now);
  let sources = episode.mediaSources;
  if (lifted) {
    // Spec 089, REQ-13 REQ-15
    sources = hasPossession(episode)
      ? [...episode.mediaSources, ...seasonSources]
      : [...episode.mediaSources, { status: 'QUEUED' as const }];
  }
  return deriveTitleStatus({
    filePath: episode.filePath,
    mediaServerPresentAt: episode.mediaServerPresentAt,
    sources,
    jobs: episode.processJobs,
  });
}

export type ShowEpisodeAltitude = {
  status: PipelineStatus;
  releaseDate: Date | null;
};

// Spec 089, REQ-11
export function deriveShowStatus(episodes: ShowEpisodeAltitude[], now: Date): PipelineStatus {
  const aired = episodes.filter((episode) => episode.releaseDate !== null && episode.releaseDate <= now);

  if (aired.length === 0) {
    return 'MISSING';
  }

  if (aired.every((episode) => episode.status === 'COMPLETED')) {
    return 'COMPLETED';
  }

  // Spec 089, REQ-12
  let best: Exclude<PipelineStatus, 'ERROR'> = 'MISSING';
  for (const episode of aired) {
    if (episode.status === 'ERROR') {
      return 'ERROR';
    }
    const contribution = episode.status === 'COMPLETED' ? 'DOWNLOADED' : episode.status;
    best = maxStatus(best, contribution);
  }

  return best;
}

export type RaceJob = {
  status: EncodeStatus;
};

// Spec 090, REQ-3; Spec 095, NFR-1; Spec 097, REQ-15
export function isRaceWinner(
  status: SourceStatus,
  jobs: RaceJob[],
  retiredAt: Date | null = null,
): boolean {
  if (retiredAt !== null) {
    return false;
  }
  if (status === 'READY') {
    return true;
  }
  if (status !== 'SCANNED') {
    return false;
  }
  if (jobs.length > 0 && jobs.every((job) => job.status === 'DISCARDED')) {
    return false;
  }
  const failed = jobs.some((job) => job.status === 'ERROR');
  const active = jobs.some((job) => ACTIVE_ENCODE_STATUSES.includes(job.status));
  if (!active && jobs.some((job) => job.status === 'STOPPED')) {
    return false;
  }
  return !(failed && !active);
}

// Spec 087, REQ-2; Spec 090, REQ-3; Spec 097, NFR-1
export function isDeliveredSource(
  status: SourceStatus,
  jobs: RaceJob[],
  retiredAt: Date | null = null,
): boolean {
  if (retiredAt !== null) {
    return false;
  }
  if (status !== 'SCANNED') {
    return false;
  }
  const active = jobs.some((job) => IN_FLIGHT_ENCODE_STATUSES.includes(job.status));
  if (active) {
    return false;
  }
  return jobs.some((job) => job.status === 'COMPLETED');
}

export type ResumeStage = 'DOWNLOAD' | 'SCAN' | 'ENCODE' | 'REPLACED';

export type ResumeJob = {
  status: EncodeStatus;
  errorKey: string | null;
  errorParams: string | null;
  errorMessage: string | null;
  updatedAt: Date;
};

export type ResumeSource = {
  status: SourceStatus;
  infoHash: string | null;
  downloadPath: string | null;
  errorKey: string | null;
  errorParams: string | null;
  errorMessage: string | null;
  updatedAt: Date;
};

// Spec 090, REQ-3
export type ResumeSibling = {
  status: SourceStatus;
  jobs: RaceJob[];
  retiredAt?: Date | null;
};

// Spec 091, REQ-6
export function hasRaceWinner(siblings: ResumeSibling[]): boolean {
  return siblings.some((sibling) => isRaceWinner(sibling.status, sibling.jobs, sibling.retiredAt ?? null));
}

export type ResumeInput = {
  status: PipelineStatus | 'DISCARDED';
  source: ResumeSource;
  jobs: ResumeJob[];
  liveState: string | null;
  siblings: ResumeSibling[];
};

export type LastError = {
  stage: ResumeStage;
  key: string;
  params: string | null;
  message: string;
};

export type ResumeVerdict = {
  lastError: LastError | null;
  retryable: boolean;
  refusalKey: string | null;
};

type Candidate = {
  fromJob: boolean;
  errorKey: string | null;
  errorParams: string | null;
  errorMessage: string | null;
  updatedAt: Date;
};

function stageOf(candidate: Candidate): ResumeStage {
  if (candidate.errorKey === ERROR_KEYS.SOURCE_REPLACED) {
    return 'REPLACED';
  }
  if (candidate.fromJob) {
    return 'ENCODE';
  }
  if (
    candidate.errorKey === ERROR_KEYS.SOURCE_NO_DOWNLOAD_PATH ||
    candidate.errorKey === ERROR_KEYS.DOWNLOAD_TORRENT_CLIENT_ERROR
  ) {
    return 'DOWNLOAD';
  }
  return 'SCAN';
}

function candidateLastError(winner: Candidate, stage: ResumeStage): LastError {
  const nullKey = winner.errorKey === null;
  const key = nullKey
    ? winner.fromJob
      ? 'error.encode.unexpected'
      : ERROR_KEYS.SOURCE_SCAN_FAILED
    : winner.errorKey!;
  return {
    stage,
    key,
    params: nullKey ? JSON.stringify({ detail: winner.errorMessage ?? '' }) : winner.errorParams,
    message: winner.errorMessage ?? MESSAGES_EN[key] ?? key,
  };
}

// Spec 095, REQ-10
export function jobLastError(job: ResumeJob): LastError | null {
  if (job.status !== 'ERROR') {
    return null;
  }
  const candidate: Candidate = { fromJob: true, ...job };
  return candidateLastError(candidate, stageOf(candidate));
}

// Spec 095, REQ-10 REQ-11
export function jobRetryable(
  job: ResumeJob,
  source: { retiredAt?: Date | null },
  siblings: ResumeSibling[],
): boolean {
  const error = jobLastError(job);
  if (error === null || error.stage === 'REPLACED') {
    return false;
  }
  if ((source.retiredAt ?? null) !== null) {
    return false;
  }
  return !hasRaceWinner(siblings);
}

// Spec 095, REQ-10; Spec 097, REQ-13
export function projectJobStatus(
  status: EncodeStatus,
): 'QUEUED' | 'ENCODING' | 'PAUSED' | 'COMPLETED' | 'ERROR' | 'DISCARDED' {
  if (status === 'WAITING') {
    return 'QUEUED';
  }
  return status === 'STOPPED' ? 'PAUSED' : status;
}

// Spec 095, REQ-15 REQ-16; Spec 097, NFR-1
export function cleanupDecision(
  jobs: RaceJob[],
  hasUnmatchedFiles: boolean,
): { removeTorrent: boolean; deleteDownloadPath: boolean } {
  return {
    removeTorrent: !jobs.some((job) => IN_FLIGHT_ENCODE_STATUSES.includes(job.status)),
    deleteDownloadPath:
      jobs.every((job) => job.status === 'COMPLETED' || job.status === 'DISCARDED') &&
      !hasUnmatchedFiles,
  };
}

const NOT_RETRYABLE_STATES = ['error', 'missingFiles'];

export function deriveResume(input: ResumeInput): ResumeVerdict {
  const { status, source, jobs, liveState, siblings } = input;

  if (status !== 'ERROR') {
    return { lastError: null, retryable: false, refusalKey: null };
  }

  const candidates: Candidate[] = [];
  if (source.status === 'ERROR') {
    candidates.push({ fromJob: false, ...source });
  }
  for (const job of jobs) {
    if (job.status === 'ERROR') {
      candidates.push({ fromJob: true, ...job });
    }
  }

  let lastError: LastError;
  let stage: ResumeStage;

  if (candidates.length > 0) {
    const winner = candidates.reduce((best, next) =>
      next.updatedAt.getTime() > best.updatedAt.getTime() ? next : best,
    );
    stage = stageOf(winner);
    lastError = candidateLastError(winner, stage);
  } else if (liveState !== null && NOT_RETRYABLE_STATES.includes(liveState)) {
    stage = 'DOWNLOAD';
    const key = ERROR_KEYS.DOWNLOAD_TORRENT_CLIENT_ERROR;
    lastError = {
      stage,
      key,
      params: JSON.stringify({ state: liveState }),
      message: MESSAGES_EN[key].replace('{state}', liveState),
    };
  } else {
    return { lastError: null, retryable: false, refusalKey: null };
  }

  let refusalKey: string | null = null;
  if (stage === 'REPLACED') {
    refusalKey = ERROR_KEYS.DOWNLOAD_RETRY_REPLACED;
  } else if (hasRaceWinner(siblings)) {
    refusalKey = ERROR_KEYS.DOWNLOAD_RETRY_SUPERSEDED;
  } else if (
    lastError.key === ERROR_KEYS.SOURCE_NO_DOWNLOAD_PATH ||
    (stage === 'SCAN' && !source.downloadPath) ||
    (stage === 'DOWNLOAD' && !source.infoHash)
  ) {
    refusalKey = ERROR_KEYS.DOWNLOAD_RETRY_UNAVAILABLE;
  }

  return { lastError, retryable: refusalKey === null, refusalKey };
}
