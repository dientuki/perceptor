import { deriveSourceStatus, deriveTitleStatus, toMediaStatus, PIPELINE_STATUSES } from './pipeline-status';

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
      jobs: [{ status: 'COMPLETED', progress: 100 }],
      live: null,
    });

    expect(result).toEqual({ status: 'COMPLETED', downloadProgress: 100, encodeProgress: 100 });
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

    expect(result).toEqual({ status: 'DOWNLOADING', downloadProgress: 37, encodeProgress: null });
  });

  it('falls back to the column with null progress when no live reading exists (AC-6)', () => {
    // NFR-4: an unreachable torrent client must not throw and must not invent a percentage.
    // If rule 6 defaulted downloadProgress to 0 instead of null, this would still pass a naive
    // "truthy" check but fail this exact equality.
    const result = deriveSourceStatus({
      sourceStatus: 'QUEUED',
      jobs: [],
      live: null,
    });

    expect(result).toEqual({ status: 'QUEUED', downloadProgress: null, encodeProgress: null });
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
        { status: 'COMPLETED', progress: 100 },
        { status: 'ENCODING', progress: 50 },
        { status: 'WAITING', progress: 0 },
      ],
      live: null,
    });

    expect(result).toEqual({ status: 'ENCODING', downloadProgress: 100, encodeProgress: 50 });
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
      jobs: [{ status: 'COMPLETED', progress: 100 }],
      live: null,
    });

    expect(result.status).toBe('ERROR');
  });

  it('resolves to ERROR when any job is ERROR, even alongside COMPLETED jobs', () => {
    const result = deriveSourceStatus({
      sourceStatus: 'SCANNED',
      jobs: [
        { status: 'COMPLETED', progress: 100 },
        { status: 'ERROR', progress: 0 },
      ],
      live: null,
    });

    expect(result.status).toBe('ERROR');
  });
});

describe('deriveTitleStatus', () => {
  it('reads COMPLETED when the column is COMPLETED, one source is ERROR and one is SCANNED with a COMPLETED job (AC-8)', () => {
    // This is the highest-value case in the suite (plan.md flags it explicitly). ERROR must come
    // from the stored column alone. `038-encode-report-durability` REQ-9 moves a demoted source's
    // own non-terminal ProcessJob rows to ERROR too, so the demoted source's job is included here
    // deliberately: if ERROR were instead read off the raw job set — i.e. any ERROR job anywhere
    // on the title short-circuits to ERROR — this would wrongly resolve to ERROR, because the
    // demoted source's failed job would poison an otherwise-completed title. Both the demoted
    // source *and* its own ERROR job must be filtered out, per REQ-4/plan.md decision 1.
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

// 047-source-deletion REQ-12: the eight-value vocabulary written back into the
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
