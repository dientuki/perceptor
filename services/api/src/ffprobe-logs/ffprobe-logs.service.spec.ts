import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FfprobeLogsService } from './ffprobe-logs.service';
import { PrismaService } from '@/prisma/prisma.service';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { I18nExceptionResponse } from '@/i18n/i18n-error';

// Reads the i18n envelope off a thrown Nest exception the same way
// `auth-error-keys.spec.ts` does: `getResponse()` is real Nest API, not a
// custom hierarchy, so this is the actual shape a GraphQL client sees on
// `extensions.i18n`, not a re-assertion of a constant against itself.
async function i18nResponseOf(fn: () => Promise<unknown>): Promise<I18nExceptionResponse> {
  try {
    await fn();
  } catch (err) {
    return (err as { getResponse: () => I18nExceptionResponse }).getResponse();
  }
  throw new Error('expected fn to reject');
}

// This suite exists because otherwise two bugs fail with no error anywhere:
//
// 1. `remove` on a missing id reaching Prisma's raw `delete` instead of
//    `findOne` first would surface a bare P2025 with no `i18n` extension —
//    exactly the un-keyed error 018-ui-i18n exists to prevent.
// 2. `findAll` ordering by `createdAt` ascending instead of descending would
//    silently return the oldest probe as "the latest", which is wrong in
//    the one way nobody notices until they're reading the wrong evidence.
//
// Both are verified by fault injection: each case is checked to fail when
// the guarding line it covers is removed.
describe('FfprobeLogsService', () => {
  let service: FfprobeLogsService;
  let prisma: {
    ffprobeLog: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      ffprobeLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FfprobeLogsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(FfprobeLogsService);
  });

  describe('record', () => {
    it('rejects an empty file with the keyed error, before touching Prisma', async () => {
      await expect(service.record('', 'json')).rejects.toBeInstanceOf(BadRequestException);
      const response = await i18nResponseOf(() => service.record('', 'json'));
      expect(response.i18n.key).toBe(ERROR_KEYS.FFPROBE_LOG_EMPTY_PAYLOAD);
      expect(prisma.ffprobeLog.create).not.toHaveBeenCalled();
    });

    it('rejects a whitespace-only ffprobe payload', async () => {
      await expect(service.record('/movies/a.mkv', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      const response = await i18nResponseOf(() => service.record('/movies/a.mkv', '   '));
      expect(response.i18n.key).toBe(ERROR_KEYS.FFPROBE_LOG_EMPTY_PAYLOAD);
      expect(prisma.ffprobeLog.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('orders by createdAt then id, both descending', async () => {
      prisma.ffprobeLog.findMany.mockResolvedValue([]);

      await service.findAll(undefined, 50, 0);

      expect(prisma.ffprobeLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('filters by exact file when given, and omits the filter otherwise', async () => {
      prisma.ffprobeLog.findMany.mockResolvedValue([]);

      await service.findAll('/movies/a.mkv', 50, 0);
      expect(prisma.ffprobeLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { file: '/movies/a.mkv' } }),
      );

      await service.findAll(undefined, 50, 0);
      expect(prisma.ffprobeLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });

  describe('remove', () => {
    it('deletes an existing row and returns true', async () => {
      prisma.ffprobeLog.findUnique.mockResolvedValue({
        id: 1,
        file: '/movies/a.mkv',
        ffprobe: '{}',
        createdAt: new Date(),
      });
      prisma.ffprobeLog.delete.mockResolvedValue({});

      await expect(service.remove(1)).resolves.toBe(true);
      expect(prisma.ffprobeLog.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('throws the keyed not_found error on a missing row, never reaching Prisma delete', async () => {
      prisma.ffprobeLog.findUnique.mockResolvedValue(null);

      await expect(service.remove(999999)).rejects.toBeInstanceOf(NotFoundException);
      const response = await i18nResponseOf(() => service.remove(999999));
      expect(response.i18n.key).toBe(ERROR_KEYS.FFPROBE_LOG_NOT_FOUND);
      expect(response.i18n.params).toEqual({ id: 999999 });
      expect(prisma.ffprobeLog.delete).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws the keyed not_found error on a missing id', async () => {
      prisma.ffprobeLog.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999999)).rejects.toBeInstanceOf(NotFoundException);
      const response = await i18nResponseOf(() => service.findOne(999999));
      expect(response.i18n.key).toBe(ERROR_KEYS.FFPROBE_LOG_NOT_FOUND);
      expect(response.i18n.params).toEqual({ id: 999999 });
    });
  });
});
