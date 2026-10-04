import {
  deriveEpisodeStatus,
  deriveResume,
  isRaceWinner,
  ResumeInput,
  deriveSourceStatus,
  deriveTitleStatus,
  isLiftedBySeasonPack,
  toMediaStatus,
  PIPELINE_STATUSES,
} from './pipeline-status';
import { SourceStatus } from '@prisma/client';

// The bug class this defends against: four incompatible status vocabularies collapsing into one
// derivation, wrong. A wrong status here renders as a confident, plausible word on screen — the
// two reported bugs in spec.md (a finished episode reading SCANNED, a downloading film reading
// QUEUED) both shipped with nothing throwing and nothing logging. Each case below is verified,
// by hand, to fail when the single rule it exists to pin down is removed or reordered.
describe('deriveSourceStatus', () => {
  it('resolves a SCANNED source with a COMPLETED job to COMPLETED, not DOWNLOADED (AC-1)', () => {
    // The reported Daredevil bug: rule 2 (all jobs COMPLETED) must be checked before rule 4
    // (no-jobs-and-READY/SCANNED). Deleting or reordering rule 2 after rule 4 falls through to
    // DOWNLOADED here, because rule 4's "no jobs" guard would then never be reached — the case
    // still has a job, so it would instead fall into rule 6 territory. Either mutation breaks it.
    const result = deriveSourceStatus({
      sourceStatus: 'SCANNED',
      jobs: [{ status: 'COMPLETED', progress: 100, encodeSpeed: null }],
      live: null,
    });

    expect(result).toEqual({
      status: 'COMPLETED',
      downloadProgress: 100,
      encodeProgress: 100,
      encodeSpeed: null,
    });
  });

  it('resolves a QUEUED source with a live downloading reading to DOWNLOADING with a percentage (AC-2)', () => {
    // The reported film: rule 5 must read live.state, not fall back to the column. If rule 5
    // stopped reading live.state (e.g. hardcoded to translateSourceStatus(sourceStatus)), this
    // would resolve to QUEUED instead of DOWNLOADING.
    const result = deriveSourceStatus({
      sourceStatus: 'QUEUED',
      jobs: [],
      live: { state: 'DOWNLOADING', progress: 0.37 },
    });

    expect(result).toEqual({
      status: 'DOWNLOADING',
      downloadProgress: 37,
      encodeProgress: null,
      encodeSpeed: null,
    });
  });

  it('floors live download progress instead of rounding it', () => {
    // 99.9% in the torrent client must not read as a finished 100%; 0.29 guards the float
    // error (0.29 * 100 === 28.999999999999996) a bare Math.floor would turn into 28.
    const at = (progress: number) =>
      deriveSourceStatus({
        sourceStatus: 'QUEUED',
        jobs: [],
        live: { state: 'DOWNLOADING', progress },
      }).downloadProgress;

    expect(at(0.999)).toBe(99);
    expect(at(0.29)).toBe(29);
    expect(at(1)).toBe(100);
  });

  it('falls back to the column with null progress when no live reading exists (AC-6)', () => {
    // Spec 043, NFR-4
    const result = deriveSourceStatus({
      sourceStatus: 'QUEUED',
      jobs: [],
      live: null,
    });

    expect(result).toEqual({
      status: 'QUEUED',
      downloadProgress: null,
      encodeProgress: null,
      encodeSpeed: null,
    });
  });

  it('never throws for any combination — the derivation is total', () => {
    expect(() =>
      deriveSourceStatus({ sourceStatus: 'PENDING', jobs: [], live: undefined }),
    ).not.toThrow();
  });

  it('takes the mean of three job progresses (100/50/0) with one ENCODING, giving ENCODING at 50 (AC-5)', () => {
    // A season pack is N jobs against one MediaSource; the row represents the pack. If the mean
    // were computed only over "active" jobs (dropping the COMPLETED and WAITING ones) it would
    // read 0 here instead of 50 — this case pins the divisor at the full job set.
    const result = deriveSourceStatus({
      sourceStatus: 'SCANNED',
      jobs: [
        { status: 'COMPLETED', progress: 100, encodeSpeed: null },
        { status: 'ENCODING', progress: 50, encodeSpeed: 1.5 },
        { status: 'WAITING', progress: 0, encodeSpeed: null },
      ],
      live: null,
    });

    expect(result).toEqual({
      status: 'ENCODING',
      downloadProgress: 100,
      encodeProgress: 50,
      encodeSpeed: 1.5,
    });
  });

  it('surfaces the ENCODING job\'s own speed (REQ-10)', () => {
    // Rule 3, the only rule allowed to return a non-null encodeSpeed. If the field were computed
    // from the whole ACTIVE_ENCODE_STATUSES set (including WAITING/QUEUED jobs with no speed of
    // their own) rather than only jobs actually ENCODING, this would still pass here — the next
    // case is what catches that mutation.
    const result = deriveSourceStatus({
      sourceStatus: 'SCANNED',
      jobs: [{ status: 'ENCODING', progress: 30, encodeSpeed: 1.23 }],
      live: null,
    });

    expect(result.encodeSpeed).toBe(1.23);
  });

  it('never surfaces a COMPLETED job\'s stale stored speed (REQ-10)', () => {
    // The same job, now COMPLETED, with the exact stored encodeSpeed value untouched — a job that
    // finished still carries whatever multiplier it last wrote. If Rule 2 (or any rule outside
    // Rule 3) read encodeSpeed off the jobs instead of hardcoding null, this would wrongly surface
    // 1.23 forever, even though nothing is encoding any more.
    const result = deriveSourceStatus({
      sourceStatus: 'SCANNED',
      jobs: [{ status: 'COMPLETED', progress: 100, encodeSpeed: 1.23 }],
      live: null,
    });

    expect(result.encodeSpeed).toBeNull();
  });

  it('never surfaces a stale COMPLETED speed beside a WAITING job with none (REQ-10)', () => {
    // A season pack where one episode finished (carrying a stale stored speed) and the next
    // hasn't started encoding yet. The source is still ENCODING overall (Rule 3), but nothing is
    // actively running, so meanEncodeSpeed's filter to job.status === 'ENCODING' must find no
    // candidates and return null, not the completed job's leftover 1.23.
    const result = deriveSourceStatus({
      sourceStatus: 'SCANNED',
      jobs: [
        { status: 'COMPLETED', progress: 100, encodeSpeed: 1.23 },
        { status: 'WAITING', progress: 0, encodeSpeed: null },
      ],
      live: null,
    });

    expect(result.status).toBe('ENCODING');
    expect(result.encodeSpeed).toBeNull();
  });

  it('converts a live progress of 0.42 to 42, not 0.42 and not 4200 (the double-multiply guard)', () => {
    // graphql-contract.md explicitly warns about this: the adapter boundary keeps 0..1, and this
    // function is the only place the *100 conversion happens. Multiplying twice anywhere in the
    // call chain (or nowhere) both fail this exact value.
    const result = deriveSourceStatus({
      sourceStatus: 'QUEUED',
      jobs: [],
      live: { state: 'DOWNLOADING', progress: 0.42 },
    });

    expect(result.downloadProgress).toBe(42);
  });

  it('resolves to ERROR when the source itself is ERROR, ignoring a COMPLETED job (AC-7 building block)', () => {
    const result = deriveSourceStatus({
      sourceStatus: 'ERROR',
      jobs: [{ status: 'COMPLETED', progress: 100, encodeSpeed: null }],
      live: null,
    });

    expect(result.status).toBe('ERROR');
  });

  it('resolves to ERROR when any job is ERROR, even alongside COMPLETED jobs', () => {
    const result = deriveSourceStatus({
      sourceStatus: 'SCANNED',
      jobs: [
        { status: 'COMPLETED', progress: 100, encodeSpeed: null },
        { status: 'ERROR', progress: 0, encodeSpeed: null },
      ],
      live: null,
    });

    expect(result.status).toBe('ERROR');
  });
});

// Spec 069, REQ-17 bug class: a title demoted to MISSING (its file left the media
// server) still reading COMPLETED/DOWNLOADED because a finished SCANNED source or COMPLETED job
// lifted it back, so the refresh looks like a no-op; and the opposite, an active job/source no
// longer lifting a title so a real download reads MISSING. Neither throws anywhere.
describe('deriveTitleStatus', () => {
  it('keeps a MISSING column MISSING beside a SCANNED source and a COMPLETED job (REQ-17)', () => {
    expect(
      deriveTitleStatus({
        status: 'MISSING',
        sources: [{ status: 'SCANNED' }],
        jobs: [{ status: 'COMPLETED' }],
      }),
    ).toBe('MISSING');
  });

  it('keeps a COMPLETED column COMPLETED beside a SCANNED source and a COMPLETED job (REQ-17)', () => {
    expect(
      deriveTitleStatus({
        status: 'COMPLETED',
        sources: [{ status: 'SCANNED' }],
        jobs: [{ status: 'COMPLETED' }],
      }),
    ).toBe('COMPLETED');
  });

  it('lifts a SCANNED source with an ENCODING job to ENCODING (REQ-17)', () => {
    expect(
      deriveTitleStatus({
        status: 'MISSING',
        sources: [{ status: 'SCANNED' }],
        jobs: [{ status: 'ENCODING' }],
      }),
    ).toBe('ENCODING');
  });

  it.each(['WAITING', 'QUEUED'] as const)('lifts a %s job to ENCODING (REQ-17)', (status) => {
    expect(deriveTitleStatus({ status: 'MISSING', sources: [], jobs: [{ status }] })).toBe('ENCODING');
  });

  it('lifts a READY source with no jobs to DOWNLOADED (REQ-17)', () => {
    expect(deriveTitleStatus({ status: 'MISSING', sources: [{ status: 'READY' }], jobs: [] })).toBe(
      'DOWNLOADED',
    );
  });

  it('lets an ERROR column win over everything (REQ-17)', () => {
    expect(
      deriveTitleStatus({
        status: 'ERROR',
        sources: [{ status: 'READY' }],
        jobs: [{ status: 'ENCODING' }],
      }),
    ).toBe('ERROR');
  });

  it('reads COMPLETED when the column is COMPLETED, one source is ERROR and one is SCANNED with a COMPLETED job (AC-8)', () => {
    // Spec 038, REQ-9; Spec 043, REQ-4
    const result = deriveTitleStatus({
      status: 'COMPLETED',
      sources: [{ status: 'ERROR' }, { status: 'SCANNED' }],
      jobs: [{ status: 'ERROR' }, { status: 'COMPLETED' }],
    });

    expect(result).toBe('COMPLETED');
  });

  it('reads ERROR when the column is ERROR, even with a COMPLETED job present (AC-7)', () => {
    // If ERROR were derived any other way than "column === ERROR", a title whose only job
    // finished successfully but whose stored status lags behind could read something other than
    // ERROR here, silently disagreeing with the row that failed.
    const result = deriveTitleStatus({
      status: 'ERROR',
      sources: [],
      jobs: [{ status: 'COMPLETED' }],
    });

    expect(result).toBe('ERROR');
  });

  it('returns the stored column verbatim with no sources and no jobs (AC-9)', () => {
    // Preserves the COMPLETED that Jellyfin reconciliation writes with no filePath and no source
    // at all. If the loop over an empty sources/jobs array somehow reset `best` to MISSING
    // instead of seeding it from the column, this would fail.
    const result = deriveTitleStatus({
      status: 'COMPLETED',
      sources: [],
      jobs: [],
    });

    expect(result).toBe('COMPLETED');
  });

  it('resolves an episode with empty mediaSources and an ENCODING job to ENCODING, not MISSING', () => {
    // The season-pack member: the episode has no MediaSource of its own (the source belongs to
    // the season), only its denormalized processJobs. If the title derivation only looked at
    // sources and ignored the job set, this would wrongly read MISSING.
    const result = deriveTitleStatus({
      status: 'MISSING',
      sources: [],
      jobs: [{ status: 'ENCODING' }],
    });

    expect(result).toBe('ENCODING');
  });

  it('keeps a COMPLETED column COMPLETED beside a QUEUED source — the maximum never regresses (NFR-3)', () => {
    // If the derivation took the *last* input's status rather than the maximum over the ranking,
    // a stale QUEUED sibling row would drag a genuinely completed title backwards.
    const result = deriveTitleStatus({
      status: 'COMPLETED',
      sources: [{ status: 'QUEUED' }],
      jobs: [],
    });

    expect(result).toBe('COMPLETED');
  });
});

// 059-season-pack-acquisition-ui: this predicate is what lets an aired episode with no
// MediaSource of its own read QUEUED/DOWNLOADING/etc. while a season pack targeting it is still
// in flight, and drop back to MISSING once the pack either matches it (SCANNED) or fails
// (ERROR). Get either exclusion wrong and one of two silent bugs ships: an in-flight pack stops
// lifting (an aired episode regresses to MISSING mid-download) or a finished/failed pack keeps
// lifting forever (an episode the pack never matched is stuck showing "in progress" with nothing
// actually happening for it).
describe('isLiftedBySeasonPack', () => {
  const now = new Date('2026-09-16T00:00:00Z');
  const aired = new Date('2026-09-01T00:00:00Z');
  const future = new Date('2026-10-01T00:00:00Z');

  const UNSCANNED_STATUSES: SourceStatus[] = ['PENDING', 'QUEUED', 'DOWNLOADING', 'PAUSED', 'READY'];

  for (const status of UNSCANNED_STATUSES) {
    it(`lifts an aired episode when a season source is ${status}`, () => {
      expect(isLiftedBySeasonPack([{ status }], aired, now)).toBe(true);
    });
  }

  it('does not lift when every season source is SCANNED', () => {
    expect(isLiftedBySeasonPack([{ status: 'SCANNED' }], aired, now)).toBe(false);
  });

  it('does not lift when every season source is ERROR', () => {
    expect(isLiftedBySeasonPack([{ status: 'ERROR' }], aired, now)).toBe(false);
  });

  it('does not lift when there are no season sources at all', () => {
    expect(isLiftedBySeasonPack([], aired, now)).toBe(false);
  });

  it('does not lift an episode whose releaseDate is still in the future', () => {
    expect(isLiftedBySeasonPack([{ status: 'DOWNLOADING' }], future, now)).toBe(false);
  });

  it('does not lift an episode with a null releaseDate', () => {
    expect(isLiftedBySeasonPack([{ status: 'DOWNLOADING' }], null, now)).toBe(false);
  });

  it('lifts an episode whose releaseDate equals now exactly', () => {
    expect(isLiftedBySeasonPack([{ status: 'DOWNLOADING' }], now, now)).toBe(true);
  });
});

// The bug class this defends against: the calendar and the show detail page each deriving an
// episode's status and drifting apart. A season-pack lift applied in one reader but not the other
// renders an aired, queued episode as MISSING in one screen and QUEUED in the other, with no error.
describe('deriveEpisodeStatus', () => {
  const now = new Date('2026-09-16T00:00:00Z');
  const aired = new Date('2026-09-01T00:00:00Z');
  const future = new Date('2026-10-01T00:00:00Z');
  const episode = (status: 'MISSING' | 'ERROR', releaseDate: Date | null) => ({
    status,
    releaseDate,
    mediaSources: [],
    processJobs: [],
  });

  it('lifts an aired episode to QUEUED while a season pack is in flight', () => {
    expect(deriveEpisodeStatus([{ status: 'DOWNLOADING' }], episode('MISSING', aired), now)).toBe('QUEUED');
  });

  it('leaves an unaired episode MISSING despite an in-flight season pack', () => {
    expect(deriveEpisodeStatus([{ status: 'DOWNLOADING' }], episode('MISSING', future), now)).toBe('MISSING');
  });

  it('lets a stored ERROR win over a lift', () => {
    expect(deriveEpisodeStatus([{ status: 'DOWNLOADING' }], episode('ERROR', aired), now)).toBe('ERROR');
  });

  it('lifts nothing when the season sources are SCANNED or ERROR', () => {
    expect(deriveEpisodeStatus([{ status: 'SCANNED' }, { status: 'ERROR' }], episode('MISSING', aired), now)).toBe(
      'MISSING',
    );
  });
});

// Spec 047, REQ-12: the eight-value vocabulary written back into the
// five-value MediaStatus column after a delete recomputes a title's status. A
// value this collapse gets wrong either rejects the Prisma write outright (a
// PipelineStatus with no matching MediaStatus member) or writes a value no
// consumer of the five-value column understands.
describe('toMediaStatus', () => {
  const expected: Record<(typeof PIPELINE_STATUSES)[number], string> = {
    MISSING: 'MISSING',
    QUEUED: 'DOWNLOADING',
    PAUSED: 'DOWNLOADING',
    DOWNLOADING: 'DOWNLOADING',
    DOWNLOADED: 'DOWNLOADING',
    ENCODING: 'ENCODING',
    COMPLETED: 'COMPLETED',
    ERROR: 'ERROR',
  };

  for (const status of PIPELINE_STATUSES) {
    it(`collapses ${status} to ${expected[status]}`, () => {
      expect(toMediaStatus(status)).toBe(expected[status]);
    });
  }
});

// The bug class this defends against: the race arbiter and the Play button disagreeing about who
// won, or a stale error being shown as the last one. Two encodes of one title, a resumable
// replaced source, or a "last error" taken from a healthy job all render plausibly with no error
// anywhere.
describe('isRaceWinner', () => {
  it('counts a READY source as the winner', () => {
    expect(isRaceWinner('READY', [])).toBe(true);
  });

  it('counts a SCANNED source with no jobs as the winner', () => {
    expect(isRaceWinner('SCANNED', [])).toBe(true);
  });

  it('does not count a SCANNED source whose every job failed', () => {
    expect(isRaceWinner('SCANNED', [{ status: 'ERROR' }, { status: 'ERROR' }])).toBe(false);
  });

  it('counts a SCANNED source with a failed job but another still encoding', () => {
    expect(isRaceWinner('SCANNED', [{ status: 'ERROR' }, { status: 'ENCODING' }])).toBe(true);
  });

  it('counts a partial pack with a failed job and a waiting job as the winner', () => {
    expect(isRaceWinner('SCANNED', [{ status: 'ERROR' }, { status: 'WAITING' }])).toBe(true);
  });

  it('counts a SCANNED source with a failed job and a completed job as not the winner', () => {
    expect(isRaceWinner('SCANNED', [{ status: 'ERROR' }, { status: 'COMPLETED' }])).toBe(false);
  });

  it.each(['PENDING', 'QUEUED', 'DOWNLOADING', 'PAUSED', 'ERROR'] as const)(
    'does not count a %s source',
    (status) => {
      expect(isRaceWinner(status, [])).toBe(false);
    },
  );
});

describe('deriveResume', () => {
  const t = (n: number) => new Date(2026, 0, 1, 0, 0, n);
  const source = (over: Partial<ResumeInput['source']> = {}): ResumeInput['source'] => ({
    status: 'SCANNED',
    infoHash: 'abc',
    downloadPath: '/d',
    errorKey: null,
    errorParams: null,
    errorMessage: null,
    updatedAt: t(0),
    ...over,
  });
  const job = (over: Partial<ResumeInput['jobs'][number]> = {}): ResumeInput['jobs'][number] => ({
    status: 'ERROR',
    errorKey: 'error.encode.ffmpeg_failed',
    errorParams: '{"a":1}',
    errorMessage: 'boom',
    updatedAt: t(1),
    ...over,
  });
  const input = (over: Partial<ResumeInput> = {}): ResumeInput => ({
    status: 'ERROR',
    source: source(),
    jobs: [job()],
    liveState: null,
    siblings: [],
    ...over,
  });

  it('reports nothing and refuses retry when the derived status is not ERROR', () => {
    expect(deriveResume(input({ status: 'COMPLETED' }))).toEqual({
      lastError: null,
      retryable: false,
      refusalKey: null,
    });
  });

  it('ignores a COMPLETED job and picks the ERROR job as the last error', () => {
    const result = deriveResume(
      input({
        jobs: [
          job({ status: 'COMPLETED', errorKey: 'error.stale', updatedAt: t(9) }),
          job({ updatedAt: t(2) }),
        ],
      }),
    );
    expect(result.lastError).toEqual({
      stage: 'ENCODE',
      key: 'error.encode.ffmpeg_failed',
      params: '{"a":1}',
      message: 'boom',
    });
    expect(result.retryable).toBe(true);
  });

  it('picks the most recent of a source error and a job error', () => {
    const result = deriveResume(
      input({
        source: source({
          status: 'ERROR',
          errorKey: 'error.source.scan_no_video',
          errorMessage: 'none',
          updatedAt: t(5),
        }),
        jobs: [job({ updatedAt: t(3) })],
      }),
    );
    expect(result.lastError?.stage).toBe('SCAN');
    expect(result.lastError?.key).toBe('error.source.scan_no_video');
  });

  it('maps a replaced source error to REPLACED and refuses it', () => {
    const result = deriveResume(
      input({
        source: source({ status: 'ERROR', errorKey: 'error.source.replaced', errorMessage: 'r' }),
        jobs: [],
      }),
    );
    expect(result.lastError?.stage).toBe('REPLACED');
    expect(result.retryable).toBe(false);
    expect(result.refusalKey).toBe('error.download.retry_replaced');
  });

  it('maps a replaced key on a job to REPLACED', () => {
    const result = deriveResume(input({ jobs: [job({ errorKey: 'error.source.replaced' })] }));
    expect(result.lastError?.stage).toBe('REPLACED');
    expect(result.refusalKey).toBe('error.download.retry_replaced');
  });

  it('maps no_download_path to DOWNLOAD and refuses it as unavailable', () => {
    const result = deriveResume(
      input({
        source: source({
          status: 'ERROR',
          errorKey: 'error.source.no_download_path',
          errorMessage: 'x',
        }),
        jobs: [],
      }),
    );
    expect(result.lastError?.stage).toBe('DOWNLOAD');
    expect(result.refusalKey).toBe('error.download.retry_unavailable');
  });

  it('refuses a SCAN-stage error when the source has no download path', () => {
    const result = deriveResume(
      input({
        source: source({
          status: 'ERROR',
          errorKey: 'error.source.scan_no_video',
          errorMessage: 'x',
          downloadPath: null,
        }),
        jobs: [],
      }),
    );
    expect(result.refusalKey).toBe('error.download.retry_unavailable');
  });

  it('falls back to scan_failed with the message as detail for a null source key', () => {
    const result = deriveResume(
      input({
        source: source({ status: 'ERROR', errorMessage: 'legacy text' }),
        jobs: [],
      }),
    );
    expect(result.lastError).toEqual({
      stage: 'SCAN',
      key: 'error.source.scan_failed',
      params: '{"detail":"legacy text"}',
      message: 'legacy text',
    });
  });

  it('falls back to encode.unexpected with the message as detail for a null job key', () => {
    const result = deriveResume(
      input({ jobs: [job({ errorKey: null, errorParams: null, errorMessage: 'old' })] }),
    );
    expect(result.lastError).toEqual({
      stage: 'ENCODE',
      key: 'error.encode.unexpected',
      params: '{"detail":"old"}',
      message: 'old',
    });
  });

  it('synthesises a torrent_client_error from a live error state with no stored error', () => {
    const result = deriveResume(
      input({ source: source({ status: 'DOWNLOADING' }), jobs: [], liveState: 'missingFiles' }),
    );
    expect(result.lastError?.stage).toBe('DOWNLOAD');
    expect(result.lastError?.key).toBe('error.download.torrent_client_error');
    expect(result.lastError?.params).toBe('{"state":"missingFiles"}');
    expect(result.lastError?.message).toContain('missingFiles');
    expect(result.retryable).toBe(true);
  });

  it('refuses a DOWNLOAD-stage live error when the source has no infoHash', () => {
    const result = deriveResume(
      input({
        source: source({ status: 'DOWNLOADING', infoHash: null }),
        jobs: [],
        liveState: 'error',
      }),
    );
    expect(result.refusalKey).toBe('error.download.retry_unavailable');
  });

  it('refuses as superseded when a sibling is the race winner, before checking availability', () => {
    const result = deriveResume(
      input({
        source: source({
          status: 'ERROR',
          errorKey: 'error.source.no_download_path',
          errorMessage: 'x',
        }),
        jobs: [],
        siblings: [{ status: 'READY', jobs: [] }],
      }),
    );
    expect(result.refusalKey).toBe('error.download.retry_superseded');
  });

  it('refuses REPLACED before superseded when both apply', () => {
    const result = deriveResume(
      input({
        jobs: [job({ errorKey: 'error.source.replaced' })],
        siblings: [{ status: 'READY', jobs: [] }],
      }),
    );
    expect(result.refusalKey).toBe('error.download.retry_replaced');
  });

  it('does not treat a sibling whose encodes all failed as a winner', () => {
    const result = deriveResume(
      input({ siblings: [{ status: 'SCANNED', jobs: [{ status: 'ERROR' }] }] }),
    );
    expect(result.retryable).toBe(true);
  });
});
