import { Test, TestingModule } from '@nestjs/testing';
import { ShowStatusSweepService } from './show-status-sweep.service';
import { TitleStatusService } from './title-status.service';
import { PrismaService } from '@/prisma/prisma.service';

// Spec 089, REQ-12 AC-13 — this suite exists because this status transition has no event behind it: a series stuck at
// COMPLETED after its next episode airs looks exactly like a correct read until someone notices
// the air date passed. The failure this defends against is silent by construction — nothing
// throws, nothing logs, the series just never gets recomputed — and it must be proven on a
// configuration where every opt-in scheduled task (`src/scheduler/tasks/`) is disabled, since
// `ShowStatusSweepService` is deliberately not one of them.
describe('ShowStatusSweepService', () => {
  let service: ShowStatusSweepService;
  let prisma: { episode: { findMany: jest.Mock } };
  let titleStatus: { recomputeShow: jest.Mock };

  beforeEach(async () => {
    prisma = { episode: { findMany: jest.fn().mockResolvedValue([]) } };
    titleStatus = { recomputeShow: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShowStatusSweepService,
        { provide: PrismaService, useValue: prisma },
        { provide: TitleStatusService, useValue: titleStatus },
      ],
    }).compile();

    service = module.get<ShowStatusSweepService>(ShowStatusSweepService);
  });

  it('recomputes a series whose episode aired since the last window, with no scheduled task enabled', async () => {
    const now = new Date('2026-10-06T12:00:00Z');
    prisma.episode.findMany.mockResolvedValue([{ season: { showId: 42 } }]);

    await service.sweep(now);

    expect(prisma.episode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { releaseDate: { gt: new Date('2026-10-06T10:00:00Z'), lte: now } },
      }),
    );
    expect(titleStatus.recomputeShow).toHaveBeenCalledWith(42);
  });

  it('recomputes each distinct series exactly once even when several episodes of the same show aired', async () => {
    const now = new Date('2026-10-06T12:00:00Z');
    prisma.episode.findMany.mockResolvedValue([
      { season: { showId: 7 } },
      { season: { showId: 7 } },
    ]);

    await service.sweep(now);

    expect(titleStatus.recomputeShow).toHaveBeenCalledTimes(1);
    expect(titleStatus.recomputeShow).toHaveBeenCalledWith(7);
  });

  it('does nothing when no episode aired inside the window', async () => {
    await service.sweep(new Date());

    expect(titleStatus.recomputeShow).not.toHaveBeenCalled();
  });

  it('keeps sweeping the remaining shows when recomputing one of them throws', async () => {
    prisma.episode.findMany.mockResolvedValue([
      { season: { showId: 1 } },
      { season: { showId: 2 } },
    ]);
    titleStatus.recomputeShow.mockRejectedValueOnce(new Error('db blip')).mockResolvedValueOnce(undefined);

    await expect(service.sweep(new Date())).resolves.toBeUndefined();

    expect(titleStatus.recomputeShow).toHaveBeenCalledWith(1);
    expect(titleStatus.recomputeShow).toHaveBeenCalledWith(2);
  });
});
