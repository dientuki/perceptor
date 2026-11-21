import type { HttpException } from '@nestjs/common';
import { ActiveEmbedGuard } from './active-embed.guard';
import { ERROR_KEYS } from '@/i18n/error-keys';
import type { PrismaService } from '@/prisma/prisma.service';

// Spec 113, T002: a SYNCING embed (measuring its offsets, nothing queued yet) must count as
// active, otherwise an acquisition or a second embed starts on a file about to be remuxed.
describe('ActiveEmbedGuard', () => {
  const count = jest.fn();
  const tagCount = jest.fn();
  const guard = new ActiveEmbedGuard({
    subtitleEmbed: { count },
    libraryTagMigrationItem: { count: tagCount },
  } as unknown as PrismaService);

  beforeEach(() => {
    count.mockReset();
    tagCount.mockReset();
    tagCount.mockResolvedValue(0);
  });

  it('queries SYNCING, QUEUED and RUNNING', async () => {
    count.mockResolvedValue(1);

    await expect(guard.hasActiveEmbed({ movieId: 1 })).resolves.toBe(true);

    expect(count).toHaveBeenCalledWith({
      where: { status: { in: ['SYNCING', 'QUEUED', 'RUNNING'] }, movieId: 1 },
    });
  });

  it('refuses with busy when a SYNCING row exists', async () => {
    count.mockResolvedValue(1);

    const error = await guard
      .assertNoActiveEmbed({ episodeId: 2 })
      .catch((e: HttpException) => e);

    expect((error as HttpException).getResponse()).toMatchObject({
      i18n: { key: ERROR_KEYS.SUBTITLE_EMBED_BUSY },
    });
  });

  // Spec 123, REQ-17
  it('refuses with libraryTags.busy when a claimed, unsettled item exists', async () => {
    count.mockResolvedValue(0);
    tagCount.mockResolvedValue(1);

    const error = await guard
      .assertNoActiveEmbed({ seasonId: 3 })
      .catch((e: HttpException) => e);

    expect((error as HttpException).getResponse()).toMatchObject({
      i18n: { key: ERROR_KEYS.LIBRARY_TAGS_BUSY },
    });
    expect(tagCount).toHaveBeenCalledWith({
      where: {
        claimedAt: { not: null },
        outcome: null,
        episode: { seasonId: 3 },
      },
    });
  });

  it('passes when the only item is settled or unclaimed', async () => {
    count.mockResolvedValue(0);
    tagCount.mockResolvedValue(0);

    await expect(guard.assertNoActiveEmbed({ movieId: 1 })).resolves.toBeUndefined();
  });

  it('keeps subtitleEmbed.busy when an embed is active even with a claimed item', async () => {
    count.mockResolvedValue(1);
    tagCount.mockResolvedValue(1);

    const error = await guard
      .assertNoActiveEmbed({ movieId: 1 })
      .catch((e: HttpException) => e);

    expect((error as HttpException).getResponse()).toMatchObject({
      i18n: { key: ERROR_KEYS.SUBTITLE_EMBED_BUSY },
    });
  });
});
