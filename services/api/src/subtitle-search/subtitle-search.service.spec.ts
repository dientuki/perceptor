import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SubtitleSearchService } from './subtitle-search.service';
import { SubtitleSearchResolver } from './subtitle-search.resolver';
import type { AuthPrincipal } from '@/auth/auth.types';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { SubtitleSyncReference } from './entities/subtitle-search.entity';

type Row = {
  id: number;
  searchId: number;
  status: 'QUEUED' | 'RUNNING' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
  reasonKey: string | null;
  offsetMs: number | null;
  score: number | null;
  stagedPath: string | null;
};

type Where = { id: number; status?: string | { in: string[] } };

// This suite exists because the worker reports a validation over a network that
// can repeat any call, and every failure here is silent: a repeat report that
// overwrites a stored verdict flips an ACCEPTED candidate to REJECTED after it
// was already embedded; a measurement the acceptance rule refuses but that is
// stored as accepted embeds a subtitle that is out of sync; a user token that
// reaches the reports lets any logged-in user rewrite a search. It runs the
// real acceptance rule over a stateful fake of the attempts table, so the
// guards under test are the production ones (Article IX, Spec 103, REQ-10).
describe('SubtitleSearchService worker reports', () => {
  let rows: Map<number, Row>;
  let wake: jest.Mock;
  let service: SubtitleSearchService;

  const matches = (row: Row, where: Where): boolean => {
    if (row.id !== where.id) return false;
    if (where.status === undefined) return true;
    if (typeof where.status === 'string') return row.status === where.status;
    return where.status.in.includes(row.status);
  };

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'sub-'));
    const staged = join(dir, '1.srt');
    writeFileSync(staged, '1\n00:00:01,000 --> 01:40:00,000\nx\n');
    rows = new Map([
      [
        1,
        {
          id: 1,
          searchId: 77,
          status: 'RUNNING',
          reasonKey: null,
          offsetMs: null,
          score: null,
          stagedPath: staged,
        },
      ],
    ]);
    wake = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      subtitleSearchAttempt: {
        findUnique: jest.fn(({ where }: { where: { id: number } }) =>
          Promise.resolve(rows.get(where.id) ?? null),
        ),
        updateMany: jest.fn(
          ({ where, data }: { where: Where; data: Partial<Row> }) => {
            const row = rows.get(where.id);
            if (!row || !matches(row, where))
              return Promise.resolve({ count: 0 });
            Object.assign(row, data);
            return Promise.resolve({ count: 1 });
          },
        ),
      },
    };
    service = new SubtitleSearchService(prisma as never, { wake } as never);
  });

  const measurement = (over: Record<string, unknown> = {}) => ({
    offsetMs: 1500,
    framerateRatio: 1,
    reference: SubtitleSyncReference.SUBTITLE,
    score: 100,
    mediaDurationMs: 6_000_000,
    lastChapterStartMs: null,
    ...over,
  });

  it('stores a rejected measurement with its reason key and wakes the search once', async () => {
    const result = await service.completed(
      1,
      measurement({ framerateRatio: 1.0427 }),
    );
    expect(result).toBe(true);
    expect(rows.get(1)).toMatchObject({
      status: 'REJECTED',
      reasonKey: ERROR_KEYS.SUBTITLE_SEARCH_FRAMERATE_MISMATCH,
      offsetMs: 1500,
    });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(77);
  });

  it('writes a repeat report nothing, keeping the first verdict and not waking again', async () => {
    await service.completed(1, measurement({ framerateRatio: 1.0427 }));
    wake.mockClear();

    const repeat = await service.completed(
      1,
      measurement({ offsetMs: 9, framerateRatio: 1 }),
    );

    expect(repeat).toBe(true);
    expect(rows.get(1)?.status).toBe('REJECTED');
    expect(rows.get(1)?.offsetMs).toBe(1500);
    expect(wake).not.toHaveBeenCalled();
  });

  it('answers false for an unknown attempt and does not report a QUEUED one as completed', async () => {
    expect(await service.completed(999, measurement())).toBe(false);
    rows.get(1)!.status = 'QUEUED';
    expect(await service.completed(1, measurement())).toBe(true);
    expect(rows.get(1)?.status).toBe('QUEUED');
  });

  it('stores an unknown failure key as sync_failed', async () => {
    await service.failed(1, 'error.something.invented');
    expect(rows.get(1)).toMatchObject({
      status: 'FAILED',
      reasonKey: ERROR_KEYS.SUBTITLE_SEARCH_SYNC_FAILED,
    });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('keeps the interrupted key and ignores a repeat failure', async () => {
    await service.failed(1, ERROR_KEYS.SUBTITLE_SEARCH_INTERRUPTED);
    wake.mockClear();
    await service.failed(1, ERROR_KEYS.SUBTITLE_SEARCH_SYNC_FAILED);
    expect(rows.get(1)?.reasonKey).toBe(ERROR_KEYS.SUBTITLE_SEARCH_INTERRUPTED);
    expect(wake).not.toHaveBeenCalled();
  });

  it('does not fail the report when the wake-up cannot be queued', async () => {
    wake.mockRejectedValue(new Error('redis down'));
    await expect(service.completed(1, measurement())).resolves.toBe(true);
    expect(rows.get(1)?.status).toBe('REJECTED');
  });

  it('moves QUEUED to RUNNING once and answers false afterwards', async () => {
    rows.get(1)!.status = 'QUEUED';
    expect(await service.started(1)).toBe(true);
    expect(await service.started(1)).toBe(false);
  });
});

// This suite exists because a user token reaching these reports would let any
// signed-in user rewrite a search, with nothing in the logs (Article IX,
// Spec 103, REQ-10).
describe('SubtitleSearchResolver service-only surface', () => {
  const user: AuthPrincipal = {
    type: 'user',
    id: 'u1',
    username: 'a',
    jti: 'j',
  };
  let service: Record<string, jest.Mock>;
  let resolver: SubtitleSearchResolver;

  beforeEach(() => {
    service = {
      details: jest.fn(),
      started: jest.fn(),
      completed: jest.fn(),
      failed: jest.fn(),
    };
    resolver = new SubtitleSearchResolver(service as never);
  });

  it('refuses a user principal on all four before touching the service', () => {
    expect(() => resolver.subtitleSyncDetails(1, user)).toThrow();
    expect(() => resolver.subtitleSyncStarted(1, user)).toThrow();
    expect(() =>
      resolver.subtitleSyncCompleted(
        1,
        0,
        1,
        SubtitleSyncReference.AUDIO,
        5,
        6000,
        null,
        user,
      ),
    ).toThrow();
    expect(() => resolver.subtitleSyncFailed(1, 'k', user)).toThrow();
    for (const mock of Object.values(service))
      expect(mock).not.toHaveBeenCalled();
  });

  it('lets the service principal through', () => {
    const svc: AuthPrincipal = { type: 'service', name: 'worker' };
    void resolver.subtitleSyncStarted(1, svc);
    expect(service.started).toHaveBeenCalledWith(1);
  });
});
