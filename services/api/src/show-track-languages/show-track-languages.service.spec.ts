/**
 * The series-level language columns are written by a side effect of a probe
 * report. If an empty scope is stored as JSON null instead of SQL NULL the
 * "never read" state becomes indistinguishable from data, and if a Prisma
 * failure escapes recompute it fails the probe report that triggered it; in
 * both cases nothing is reported anywhere.
 */
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShowTrackLanguagesService } from './show-track-languages.service';

const build = () => {
  const prisma = {
    episode: { findMany: jest.fn() },
    show: { update: jest.fn(), findMany: jest.fn() },
  };
  const service = new ShowTrackLanguagesService(prisma as never);
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  return { prisma, service, warn };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ShowTrackLanguagesService.recompute', () => {
  it('writes Prisma.DbNull, not JSON null, when no episode is in scope', async () => {
    const { prisma, service } = build();
    prisma.episode.findMany.mockResolvedValue([]);
    await service.recompute(5);
    expect(prisma.show.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        fileAudioLanguages: Prisma.DbNull,
        fileSubtitleLanguages: Prisma.DbNull,
      },
    });
  });

  it('writes the intersection when episodes were read', async () => {
    const { prisma, service } = build();
    const at = new Date();
    prisma.episode.findMany.mockResolvedValue([
      {
        tracksReadAt: at,
        fileAudioLanguages: ['eng', 'spa'],
        fileSubtitleLanguages: ['eng'],
        season: { seasonNumber: 1 },
      },
      {
        tracksReadAt: at,
        fileAudioLanguages: ['eng'],
        fileSubtitleLanguages: ['eng'],
        season: { seasonNumber: 1 },
      },
    ]);
    await service.recompute(5);
    expect(prisma.show.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { fileAudioLanguages: ['eng'], fileSubtitleLanguages: ['eng'] },
    });
  });

  it('swallows and logs a Prisma failure with the show id', async () => {
    const { prisma, service, warn } = build();
    prisma.episode.findMany.mockResolvedValue([]);
    prisma.show.update.mockRejectedValue(new Error('P2025'));
    await expect(service.recompute(9)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('show 9'));
  });
});

describe('ShowTrackLanguagesService.backfill', () => {
  it('recomputes every show sequentially and survives one failing', async () => {
    const { prisma, service } = build();
    prisma.show.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.episode.findMany.mockRejectedValueOnce(new Error('boom'));
    prisma.episode.findMany.mockResolvedValue([]);
    await service.backfill();
    expect(prisma.episode.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.show.update).toHaveBeenCalledTimes(1);
  });
});
