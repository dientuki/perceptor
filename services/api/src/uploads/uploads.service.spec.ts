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
// arbiter added later by 022-download-status-tags.
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

  function build(options: { replaceAuthorised: boolean; existing: Row[] }) {
    const rows = options.existing.map((row) => ({ ...row }));

    const prisma = {
      movie: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: MOVIE_ID, status: 'COMPLETED' }),
        update: jest.fn().mockResolvedValue({}),
      },
      mediaSource: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const row of rows) {
            if (row.movieId !== where.movieId) continue;
            if (!where.status.in.includes(row.status)) continue;
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

    return { service, prisma, queue, downloads, rows };
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
});
