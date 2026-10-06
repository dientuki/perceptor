import { mkdtemp, mkdir, writeFile, readFile, readdir, access } from 'node:fs/promises';
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
// the file entry point (Spec 027, AC-7), against the race
// arbiter added later, and that an upload always wins its target's
// race whether or not a replace ticket authorised it (Spec 038, REQ-6), that a
// demotion closes every ProcessJob it orphans (Spec 038, REQ-9), and that a loser of
// an upload-versus-upload race gets a 409 instead of a silent no-op (Spec 038, REQ-7).
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
      // Spec 038, REQ-9
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
          ? { outcome: 'SUPERSEDED' as const, message: `ignorado: mediaSource ${mediaSourceId} superado por otro source de este target` }
          : { outcome: 'WON' as const, message: `ganador: mediaSource ${mediaSourceId}, 0 pausado(s)` };
      }),
      // Spec 087, REQ-2
      hasDeliveredSource: jest.fn().mockResolvedValue(false),
    };

    const queue = { addSourceReady: jest.fn().mockResolvedValue(undefined) };

    const service = new UploadsService(
      prisma as any,
      { getMap: jest.fn().mockResolvedValue({ path_downloads: '.' }) } as any,
      { resolveFromRoot: jest.fn(async () => downloadsRoot) } as any,
      queue as any,
      uploadTickets as any,
      downloads as any,
      {} as any,
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

  // Spec 038, T007: this is the incident Spec 038, REQ-6 exists to
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

    // Spec 038, AC-6; Spec 038, REQ-7
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
      expect(results.every((r: { outcome: string }) => r.outcome === 'WON')).toBe(true);
    });
  });

  // Spec 038, AC-9
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
      // Spec 038, REQ-9
      expect(byId(3).status).toBe('COMPLETED');
    });
  });

  // Spec 038, AC-10
  // resolves instead of rejecting with a 409.
  describe('REQ-7/AC-10: a row demoted out from under its own resolveRace', () => {
    it('throws 409 with error.upload.superseded rather than returning silently', async () => {
      const { service, downloads } = build({
        replaceAuthorised: true,
        existing: [],
      });
      // Simulates the race: by the time this upload's own resolveRace runs,
      // a newer, concurrent upload has already taken the target.
      downloads.resolveRace.mockResolvedValue({
        outcome: 'SUPERSEDED',
        message: `ignorado: mediaSource ${NEW_SOURCE_ID} superado por otro source de este target`,
      });

      await expect(
        (service as any).handleUploadFinish(await stageUpload('upload-loses-own-race')),
      ).rejects.toMatchObject({
        status_code: 409,
        body: expect.stringContaining(ERROR_KEYS.UPLOAD_SUPERSEDED),
      });
    });
  });

  // This test exists because otherwise a losing upload fails with no error
  // anywhere that matters later: before Spec 087, REQ-5, handleUploadFinish
  // threw its 409 after having already created a READY MediaSource, and
  // resolveRace never touched that row on the SUPERSEDED branch — it just
  // answered a string. That orphan stayed READY, which is itself a race
  // winner by isRaceWinner, so it silently blocked every future source of
  // the same target with no error anywhere. resolveRace now writes the
  // superseded row to ERROR itself (asserted directly in
  // downloads.service.spec.ts, Spec 087, NFR-5); this only defends that
  // uploads.service.ts trusts that write on the throw path rather than
  // leaving the row at its creation-time status.
  describe('REQ-5: a losing upload leaves its own source ERROR, not READY', () => {
    it('throws 409 and the just-created MediaSource reads ERROR afterward', async () => {
      const { service, downloads, rows } = build({
        replaceAuthorised: true,
        existing: [],
      });
      downloads.resolveRace.mockImplementation(async (mediaSourceId: number) => {
        const row = rows.find((candidate) => candidate.id === mediaSourceId)!;
        row.status = 'ERROR';
        return {
          outcome: 'SUPERSEDED' as const,
          message: `ignorado: mediaSource ${mediaSourceId} superado por otro source de este target`,
        };
      });

      await expect(
        (service as any).handleUploadFinish(await stageUpload('upload-orphan-must-error')),
      ).rejects.toMatchObject({ status_code: 409 });

      expect(rows.find((row) => row.id === NEW_SOURCE_ID)!.status).toBe('ERROR');
    });
  });
});

// Defends the session branch of the tus hooks (068-season-multi-file-upload):
// the many files of one season upload landing in the session's own folder.
//
// Every failure here is silent. A file written outside the session folder
// answers 200 to the browser and the episode simply never encodes, because
// the scan looks elsewhere. Two files sharing a basename that overwrite each
// other collapse into one and an episode vanishes from an otherwise
// successful season. A session closed or deleted mid-upload that still
// accepts the file leaves an orphan on disk under a folder nobody scans. And
// a session finish that created a MediaSource or resolved a race per file
// would enqueue a scan per file instead of one when the season is closed.
// Remove the `isInsideRoot` re-check, the `taken` disambiguation in
// moveIntoSession, or the null-session guard and the matching case goes red.
//
// The filesystem is real (mkdtemp) because the collision property is about
// what rename() really does to a real directory; Prisma, the queue and the
// arbiter are stubs asserted never to be called.
describe('UploadsService session branch (season multi-file upload)', () => {
  const SESSION_ID = 7;
  const OWNER_ID = 3;

  let downloadsRoot: string;
  let outsideRoot: string;
  let sessionDir: string;

  beforeEach(async () => {
    downloadsRoot = await mkdtemp(join(tmpdir(), 'uploads-session-root-'));
    outsideRoot = await mkdtemp(join(tmpdir(), 'uploads-session-outside-'));
    sessionDir = join(downloadsRoot, 'imports', 'season-7');
    await mkdir(sessionDir, { recursive: true });
  });

  function build(options: { session: { downloadPath: string | null } | null; ownerId?: string | number | null }) {
    const prisma: any = {
      mediaSource: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
      movie: { findUnique: jest.fn(), update: jest.fn() },
      episode: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    const uploadTickets = {
      getUploadOwner: jest.fn().mockResolvedValue(options.ownerId === undefined ? OWNER_ID : options.ownerId),
      verifyAndSpend: jest.fn().mockResolvedValue({ userId: OWNER_ID, force: false }),
      markUploadOwner: jest.fn().mockResolvedValue(undefined),
    };
    const downloads = { resolveRace: jest.fn() };
    const queue = { addSourceReady: jest.fn() };
    const sessions = { findOpenSeasonSession: jest.fn().mockResolvedValue(options.session) };
    // Real containment semantics over the temp root, not a constant answer.
    const mediaRoots = {
      resolveFromRoot: jest.fn(async () => downloadsRoot),
      isInsideRoot: jest.fn(async (_id: string, p: string) => p === downloadsRoot || p.startsWith(downloadsRoot + '/')),
    };

    const service = new UploadsService(
      prisma,
      { getMap: jest.fn().mockResolvedValue({ path_downloads: '.' }) } as any,
      mediaRoots as any,
      queue as any,
      uploadTickets as any,
      downloads as any,
      sessions as any,
    );
    return { service, prisma, queue, downloads, sessions, uploadTickets };
  }

  async function stage(uploadId: string, filename: string, extra: Record<string, string> = {}) {
    const staged = join(downloadsRoot, 'uploads', uploadId);
    await mkdir(join(downloadsRoot, 'uploads'), { recursive: true });
    await writeFile(staged, `bytes-${uploadId}`);
    return {
      id: uploadId,
      metadata: { mediaSourceId: String(SESSION_ID), filename, ...extra } as Record<string, string>,
      storage: { path: staged },
    };
  }

  const exists = (p: string) => access(p).then(() => true, () => false);

  it('refuses a session whose downloadPath escapes the downloads root, before any write', async () => {
    const { service } = build({ session: { downloadPath: outsideRoot } });
    const upload = await stage('up-escape', 'e01.mkv');

    await expect((service as any).handleUploadFinish(upload)).rejects.toMatchObject({
      status_code: 409,
      body: expect.stringContaining(ERROR_KEYS.UPLOAD_SESSION_CLOSED),
    });

    expect(await readdir(outsideRoot)).toEqual([]);
    expect(await exists(upload.storage.path)).toBe(true);
  });

  it('keeps both files when two uploads share a basename, never overwriting the first', async () => {
    const { service } = build({ session: { downloadPath: sessionDir } });
    const first = await stage('up-first', 'episode.mkv');
    const second = await stage('up-second', 'episode.mkv');

    await (service as any).handleUploadFinish(first);
    await (service as any).handleUploadFinish(second);

    expect((await readdir(sessionDir)).sort()).toEqual(['episode.mkv', 'episode.up-second.mkv']);
    expect(await readFile(join(sessionDir, 'episode.mkv'), 'utf8')).toBe('bytes-up-first');
    expect(await readFile(join(sessionDir, 'episode.up-second.mkv'), 'utf8')).toBe('bytes-up-second');
  });

  it('answers 409 session_closed when the session was closed or deleted mid-upload', async () => {
    const { service } = build({ session: null });
    const upload = await stage('up-closed', 'e02.mkv');

    await expect((service as any).handleUploadFinish(upload)).rejects.toMatchObject({
      status_code: 409,
      body: expect.stringContaining(ERROR_KEYS.UPLOAD_SESSION_CLOSED),
    });

    expect(await readdir(sessionDir)).toEqual([]);
    expect(await exists(upload.storage.path)).toBe(true);
  });

  it('answers 409 session_closed when the upload has no recorded owner', async () => {
    const { service, sessions } = build({ session: { downloadPath: sessionDir }, ownerId: null });

    await expect((service as any).handleUploadFinish(await stage('up-orphan', 'e03.mkv'))).rejects.toMatchObject({
      status_code: 409,
    });
    expect(sessions.findOpenSeasonSession).not.toHaveBeenCalled();
    expect(await readdir(sessionDir)).toEqual([]);
  });

  it.each([
    ['movieId', { movieId: '2' }],
    ['episodeId', { episodeId: '5' }],
  ])('rejects mediaSourceId together with %s as 400 metadata_incomplete, on create and on finish', async (_n, extra) => {
    const { service, uploadTickets, sessions } = build({ session: { downloadPath: sessionDir } });
    const upload = await stage('up-mixed', 'e04.mkv', extra);

    await expect((service as any).handleUploadFinish(upload)).rejects.toMatchObject({ status_code: 400 });

    const req = new Request('http://x/uploads', { headers: { authorization: 'Bearer t' } });
    await expect(service.onUploadCreate(req, upload)).rejects.toMatchObject({
      status_code: 400,
      body: expect.stringContaining(ERROR_KEYS.UPLOAD_METADATA_INCOMPLETE),
    });

    // A malformed create must not burn the ticket or touch the session.
    expect(uploadTickets.verifyAndSpend).not.toHaveBeenCalled();
    expect(sessions.findOpenSeasonSession).not.toHaveBeenCalled();
    expect(await exists(upload.storage.path)).toBe(true);
  });

  it('creates no MediaSource, resolves no race and enqueues nothing when a session file finishes', async () => {
    const { service, prisma, downloads, queue } = build({ session: { downloadPath: sessionDir } });

    await (service as any).handleUploadFinish(await stage('up-ok', 'e05.mkv'));

    expect(await exists(join(sessionDir, 'e05.mkv'))).toBe(true);
    expect(prisma.mediaSource.create).not.toHaveBeenCalled();
    expect(prisma.mediaSource.update).not.toHaveBeenCalled();
    expect(prisma.episode.update).not.toHaveBeenCalled();
    expect(prisma.movie.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(downloads.resolveRace).not.toHaveBeenCalled();
    expect(queue.addSourceReady).not.toHaveBeenCalled();
  });
});
