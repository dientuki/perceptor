import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_KEYS } from '@/i18n/error-keys';

// `@tus/server`/`@tus/file-store` ship ESM only and Jest does not transform
// node_modules here. Nothing in this spec constructs the tus Server (that
// happens in onModuleInit, which is never called), so stubbing the two
// imports out is enough to load the module under test.
jest.mock('@tus/server', () => ({ Server: class {} }));
jest.mock('@tus/file-store', () => ({ FileStore: class {} }));

import { UploadsService } from './uploads.service';

// Defends the confirmed replacement of an already-downloaded title through
// the file entry point (027-replace-completed-media AC-7), against the race
// arbiter added later by 022-download-status-tags, and — since
// 038-encode-report-durability — that an upload always wins its target's
// race whether or not a replace ticket authorised it (REQ-6), that a
// demotion closes every ProcessJob it orphans (REQ-9), and that a loser of
// an upload-versus-upload race gets a 409 instead of a silent no-op (REQ-7).
//
// The bug this covers is silent and total: the upload finishes, the file is
// staged, the MediaSource row is created — and then resolveRace sees the
// superseded READY/SCANNED source still sitting on the target, decides this
// target "already has a winner", and drops the upload. Nothing is enqueued,
// the film stays COMPLETED with its old file, and the only evidence is one
// `ignorado` line in the api log. Remove the demoteSupersededSources call in
// handleUploadFinish and the first case below fails exactly that way.
//
// Everything except the filesystem and Prisma is a stub: the property under
// test is the *ordering* of demote-before-create-before-resolveRace, which a
// real DB would only make slower to assert, not more true.
describe('UploadsService.handleUploadFinish (replacement)', () => {
  const MOVIE_ID = 2;
  const NEW_SOURCE_ID = 99;

  type Row = { id: number; status: string; movieId: number | null };
  type JobRow = { id: number; mediaSourceId: number; status: string };

  function build(options: {
    replaceAuthorised: boolean;
    existing: Row[];
    jobs?: JobRow[];
    movieStatus?: string;
  }) {
    const rows = options.existing.map((row) => ({ ...row }));
    const jobRows = (options.jobs ?? []).map((row) => ({ ...row }));

    const prisma: any = {
      movie: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: MOVIE_ID, status: options.movieStatus ?? 'COMPLETED' }),
        update: jest.fn().mockResolvedValue({}),
      },
      mediaSource: {
        // Finds every source of the target sitting in a "finished" status —
        // exactly the demoteSupersededSources's `where` shape, never a
        // status-blind scan of the whole table.
        findMany: jest.fn(async ({ where }: any) => {
          return rows
            .filter((row) => row.movieId === where.movieId && where.status.in.includes(row.status))
            .map((row) => ({ id: row.id }));
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ids: number[] = where.id.in;
          let count = 0;
          for (const row of rows) {
            if (!ids.includes(row.id)) continue;
            row.status = data.status;
            count++;
          }
          return { count };
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: NEW_SOURCE_ID,
            status: data.status,
            movieId: data.movieId,
          };
          rows.push(row);
          return row;
        }),
      },
      // REQ-9: the demotion must close every non-terminal ProcessJob of the
      // sources it demotes — reached through sourceFile.mediaSourceId, never
      // a status-blind updateMany over the whole table.
      processJob: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const mediaSourceIds: number[] = where.sourceFile.mediaSourceId.in;
          const statuses: string[] = where.status.in;
          let count = 0;
          for (const job of jobRows) {
            if (!mediaSourceIds.includes(job.mediaSourceId)) continue;
            if (!statuses.includes(job.status)) continue;
            job.status = data.status;
            count++;
          }
          return { count };
        }),
      },
      // demoteSupersededSources runs inside a $transaction; the mock's tx
      // object is prisma itself, since every method it calls is already
      // stubbed above.
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const uploadTickets = {
      isReplaceAuthorised: jest
        .fn()
        .mockResolvedValue(options.replaceAuthorised),
    };

    // The real arbiter's one-winner guard, reduced to the single question
    // this spec is about: does any *other* source of the target still stand
    // in READY/SCANNED when the upload asks to win?
    const downloads = {
      resolveRace: jest.fn(async (mediaSourceId: number) => {
        const winner = rows.find((row) => row.id === mediaSourceId)!;
        const alreadyWon = rows.some(
          (row) =>
            row.id !== mediaSourceId &&
            row.movieId === winner.movieId &&
            ['READY', 'SCANNED'].includes(row.status),
        );
        return alreadyWon
          ? `ignorado: mediaSource ${mediaSourceId} superado por otro source de este target`
          : `ganador: mediaSource ${mediaSourceId}, 0 pausado(s)`;
      }),
    };

    const queue = { addSourceReady: jest.fn().mockResolvedValue(undefined) };

    const service = new UploadsService(
      prisma as any,
      { getMap: jest.fn().mockResolvedValue({ path_downloads: '.' }) } as any,
      { resolveFromRoot: jest.fn(async () => downloadsRoot) } as any,
      queue as any,
      uploadTickets as any,
      downloads as any,
    );

    return { service, prisma, queue, downloads, rows, jobRows };
  }

  let downloadsRoot: string;

  beforeEach(async () => {
    downloadsRoot = await mkdtemp(join(tmpdir(), 'uploads-spec-'));
  });

  async function stageUpload(uploadId: string) {
    const staged = join(downloadsRoot, 'uploads', uploadId);
    await mkdir(join(downloadsRoot, 'uploads'), { recursive: true });
    await writeFile(staged, 'video-bytes');
    return {
      id: uploadId,
      metadata: { movieId: String(MOVIE_ID), filename: 'replacement.mkv' },
      storage: { path: staged },
    };
  }

  it('adopts an authorised replacement of a film whose previous source already finished', async () => {
    const { service, queue, prisma, rows } = build({
      replaceAuthorised: true,
      existing: [{ id: 2, status: 'SCANNED', movieId: MOVIE_ID }],
    });

    const upload = await stageUpload('upload-replace');
    await (service as any).handleUploadFinish(upload);

    expect(rows.find((row) => row.id === 2)!.status).toBe('ERROR');
    expect(prisma.mediaSource.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorKey: ERROR_KEYS.SOURCE_REPLACED }),
      }),
    );
    expect(prisma.movie.update).toHaveBeenCalledWith({
      where: { id: MOVIE_ID },
      data: { status: 'ENCODING' },
    });
    expect(queue.addSourceReady).toHaveBeenCalledWith({
      mediaSourceId: NEW_SOURCE_ID,
    });

    // The staged file really moved into its own imports/<id> namespace.
    const moved = join(
      downloadsRoot,
      'imports',
      'upload-replace',
      'replacement.mkv',
    );
    await expect(readFile(moved, 'utf8')).resolves.toBe('video-bytes');
  });

  it('leaves a still-downloading sibling for the arbiter instead of demoting it', async () => {
    const { service, rows } = build({
      replaceAuthorised: true,
      existing: [
        { id: 2, status: 'SCANNED', movieId: MOVIE_ID },
        { id: 3, status: 'DOWNLOADING', movieId: MOVIE_ID },
      ],
    });

    await (service as any).handleUploadFinish(
      await stageUpload('upload-mixed'),
    );

    expect(rows.find((row) => row.id === 3)!.status).toBe('DOWNLOADING');
  });

  it('refuses an unauthorised upload against a COMPLETED film without touching any source', async () => {
    const { service, prisma, queue } = build({
      replaceAuthorised: false,
      existing: [{ id: 2, status: 'SCANNED', movieId: MOVIE_ID }],
    });

    await expect(
      (service as any).handleUploadFinish(await stageUpload('upload-forged')),
    ).rejects.toMatchObject({
      status_code: 409,
    });
    expect(prisma.mediaSource.updateMany).not.toHaveBeenCalled();
    expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    expect(queue.addSourceReady).not.toHaveBeenCalled();
  });

  // 038-encode-report-durability, T007: this is the incident REQ-6 exists to
  // close. The pre-fix code opened demoteSupersededSources with
  // `if (!(await this.uploadTickets.isReplaceAuthorised(uploadId))) return;`
  // — an upload against a target whose status never reached COMPLETED (so no
  // replace ticket was ever minted, let alone authorised) hit that guard,
  // returned without demoting the SCANNED sibling, and then lost its own
  // race to it: the upload finished, staged a file nobody ever used, and the
  // title never moved. Restore that guard and this case goes red, because
  // `isReplaceAuthorised` is stubbed `false` on purpose — a target that was
  // never COMPLETED has no replace ticket to authorise.
  describe('REQ-6/REQ-7: an upload always wins its target\'s race, authorised or not', () => {
    it('demotes a SCANNED sibling and moves the title to ENCODING even with no replace authorisation', async () => {
      const { service, prisma, queue, rows } = build({
        replaceAuthorised: false,
        movieStatus: 'DOWNLOADING',
        existing: [{ id: 2, status: 'SCANNED', movieId: MOVIE_ID }],
      });

      const upload = await stageUpload('upload-uncontested-replace');
      await (service as any).handleUploadFinish(upload);

      expect(rows.find((row) => row.id === 2)!.status).toBe('ERROR');
      expect(prisma.movie.update).toHaveBeenCalledWith({
        where: { id: MOVIE_ID },
        data: { status: 'ENCODING' },
      });
      expect(queue.addSourceReady).toHaveBeenCalledWith({
        mediaSourceId: NEW_SOURCE_ID,
      });
    });

    // AC-6: no `ignorado` outcome reaches the caller silently — REQ-7's two
    // permitted outcomes (queued job, or an error) are the only ones left.
    it('never resolves to the losing race outcome for the target’s own new upload', async () => {
      const { service, downloads } = build({
        replaceAuthorised: false,
        movieStatus: 'DOWNLOADING',
        existing: [{ id: 2, status: 'SCANNED', movieId: MOVIE_ID }],
      });

      await (service as any).handleUploadFinish(
        await stageUpload('upload-no-ignorado'),
      );

      const results = await Promise.all(downloads.resolveRace.mock.results.map((r) => r.value));
      expect(results.every((r: string) => r.startsWith('ganador'))).toBe(true);
    });
  });

  // AC-9: a demotion must leave no ProcessJob of the demoted source in a
  // non-terminal state — a row left WAITING/QUEUED/ENCODING is exactly the
  // wedged state this feature exists to prevent, just re-created by its own
  // fix. Delete the processJob.updateMany call inside demoteSupersededSources
  // and this case goes red: `WAITING`/`ENCODING` never flip to `ERROR`.
  describe('REQ-9: demotion closes the ProcessJob rows it orphans', () => {
    it('moves every non-terminal ProcessJob of the demoted source to ERROR, leaving a terminal one alone', async () => {
      const { service, jobRows } = build({
        replaceAuthorised: true,
        existing: [{ id: 2, status: 'SCANNED', movieId: MOVIE_ID }],
        jobs: [
          { id: 1, mediaSourceId: 2, status: 'ENCODING' },
          { id: 2, mediaSourceId: 2, status: 'WAITING' },
          { id: 3, mediaSourceId: 2, status: 'COMPLETED' },
        ],
      });

      await (service as any).handleUploadFinish(
        await stageUpload('upload-orphan-check'),
      );

      const byId = (id: number) => jobRows.find((job) => job.id === id)!;
      expect(byId(1).status).toBe('ERROR');
      expect(byId(2).status).toBe('ERROR');
      // A job that had already reported is left exactly as it was — REQ-9
      // closes non-terminal jobs, it does not rewrite history.
      expect(byId(3).status).toBe('COMPLETED');
    });
  });

  // AC-10: reachable only when a *concurrent* upload demotes this row
  // between its own `create` and its own `resolveRace` call — the loser of
  // an upload-versus-upload race. The pre-fix code returned silently here
  // (`if (raceResult.startsWith('ignorado')) { console.log(...); return; }`),
  // leaving the caller's request looking like a success with nothing behind
  // it. Restore that silent return and this case goes red: the promise
  // resolves instead of rejecting with a 409.
  describe('REQ-7/AC-10: a row demoted out from under its own resolveRace', () => {
    it('throws 409 with error.upload.superseded rather than returning silently', async () => {
      const { service, downloads } = build({
        replaceAuthorised: true,
        existing: [],
      });
      // Simulates the race: by the time this upload's own resolveRace runs,
      // a newer, concurrent upload has already taken the target.
      downloads.resolveRace.mockResolvedValue(
        `ignorado: mediaSource ${NEW_SOURCE_ID} superado por otro source de este target`,
      );

      await expect(
        (service as any).handleUploadFinish(await stageUpload('upload-loses-own-race')),
      ).rejects.toMatchObject({
        status_code: 409,
        body: expect.stringContaining(ERROR_KEYS.UPLOAD_SUPERSEDED),
      });
    });
  });
});
