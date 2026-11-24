import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SubtitleUploadStaging } from './upload-staging';

// This suite exists because upload staging holds copies of user files under the downloads root and
// nothing else ever looks at that directory: a sweep that deletes a directory whose embed is still
// queued or running makes the remux fail on a missing file, a sweep that keeps a terminal embed's
// directory leaks files forever with no error anywhere, and a removal that follows a path outside
// the downloads root would delete data the user never uploaded (Article IX, Spec 124, REQ-12).
describe('SubtitleUploadStaging', () => {
  let baseDir: string;
  let downloads: string;
  let staging: SubtitleUploadStaging;
  let statuses: Record<number, string>;

  const uploadDir = () => join(downloads, '.perceptor', 'subtitle-upload');
  const names = async () => (await readdir(uploadDir())).sort();

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'upload-staging-spec-'));
    downloads = join(baseDir, 'downloads');
    await mkdir(downloads, { recursive: true });
    const mediaRoots = new MediaRootsService([
      {
        id: 'library',
        label: 'Biblioteca',
        hostPath: '/host/library',
        containerPath: join(baseDir, 'library'),
      },
      {
        id: 'downloads',
        label: 'Descargas',
        hostPath: '/host/downloads',
        containerPath: downloads,
      },
    ]);
    statuses = {};
    const prisma = {
      subtitleEmbed: {
        findUnique: jest.fn(({ where }: { where: { id: number } }) =>
          Promise.resolve(
            statuses[where.id] ? { status: statuses[where.id] } : null,
          ),
        ),
      },
    };
    staging = new SubtitleUploadStaging(
      mediaRoots,
      prisma as unknown as PrismaService,
    );
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('writes under the embed own directory and keeps the directory of an active embed on sweep', async () => {
    const path = await staging.write(1, 0, Buffer.from('a'));
    expect(path).toBe(join(uploadDir(), '1', '0.srt'));
    await staging.write(2, 0, Buffer.from('b'));
    await staging.write(3, 0, Buffer.from('c'));
    statuses = { 1: 'SYNCING', 2: 'QUEUED', 3: 'RUNNING' };

    await staging.sweep();

    expect(await names()).toEqual(['1', '2', '3']);
  });

  it('removes the directory of a terminal or unknown embed on sweep', async () => {
    await staging.write(1, 0, Buffer.from('a'));
    await staging.write(2, 0, Buffer.from('b'));
    await staging.write(3, 0, Buffer.from('c'));
    statuses = { 1: 'COMPLETED', 2: 'FAILED' };

    await staging.sweep();

    expect(await names()).toEqual([]);
  });

  it('never removes a path outside the downloads root', async () => {
    const outside = join(baseDir, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'keep.txt'), 'x');
    await mkdir(uploadDir(), { recursive: true });
    await writeFile(join(uploadDir(), 'notes.txt'), 'x');
    await mkdir(join(uploadDir(), '07'), { recursive: true });

    await staging.removeEmbed(-1);
    await staging.removeEmbed(Number.NaN);
    await staging.sweep();

    expect(await readdir(outside)).toEqual(['keep.txt']);
    expect(await names()).toEqual(['07', 'notes.txt']);
  });

  it('removeEmbed deletes only that embed directory and never throws', async () => {
    await staging.write(1, 0, Buffer.from('a'));
    await staging.write(2, 0, Buffer.from('b'));

    await staging.removeEmbed(1);
    await expect(staging.removeEmbed(99)).resolves.toBeUndefined();

    expect(await names()).toEqual(['2']);
  });
});
