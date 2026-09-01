import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { parseMagnet } from '@/clients/torrent/magnet';
import { resolveInfoHash } from '@/clients/indexer/resolve-info-hash';
import { SourceKind } from '@prisma/client';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { MESSAGES_EN } from '@/i18n/messages.en';

// REQ-5: comma -> space, whitespace collapsed, trimmed; never sent raw
// since a comma is qBittorrent's tag separator. A title that sanitises to
// nothing falls back to a stable tag derived from the target row's id, not
// the MediaSource's, so it is reproducible later from the target alone and
// shared by every source of it (REQ-4). Kept local rather than shared with
// MoviesService's copy — see attachTorrentSource's own comment for why.
function sanitizeTag(title: string, fallbackId: number): string {
  const cleaned = title.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || `id-${fallbackId}`;
}

// REQ-2: an episode's torrent carries three tags — the show's title,
// `Season <n>` and `Episode <n>`, English keywords, unpadded numbers,
// deliberately different from the zero-padded S03E08 form used elsewhere.
function episodeTags(episode: {
  episodeNumber: number;
  season: { seasonNumber: number; show: { id: number; title: string } };
}): string[] {
  return [
    sanitizeTag(episode.season.show.title, episode.season.show.id),
    `Season ${episode.season.seasonNumber}`,
    `Episode ${episode.episodeNumber}`,
  ];
}

// Structural twin of MoviesService.findOneFromDb, one relation deeper:
// ownership runs through episode -> season -> show -> UserShow rather than
// a direct join, but the rule is identical — null covers both "does not
// exist" and "exists but belongs to someone else's show", indistinguishably
// (see spec.md's 010-episode-acquisition § Errors).
@Injectable()
export class EpisodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qbittorrent: QbittorrentClient,
  ) {}

  async findOneFromDb(id: number, userId: string) {
    return this.prisma.episode.findFirst({
      where: { id, season: { show: { users: { some: { userId } } } } },
      include: { season: { include: { show: true } } },
    });
  }

  // Every owner relation is symmetric since 022-download-status-tags
  // (MediaSource.movieId is now a real column too), so "has an active
  // source" is the same query shape for a film, an episode or a season.
  // Reused by `attachTorrentSource` below and by
  // `UploadsResolver.createUploadTicket`'s pre-flight conflict check
  // (027-replace-completed-media REQ-6), so both entry points agree on the
  // same definition of "busy".
  async findActiveSource(episodeId: number) {
    return this.prisma.mediaSource.findFirst({
      where: { episodeId, status: { not: 'ERROR' } },
    });
  }

  async addTorrentToEpisode(
    episodeId: number,
    input: { infoHash: string | null; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    // REQ-4: the search response may not carry an infoHash — resolve it here, once, before
    // anything reaches qBittorrent, so a failure never leaves a half-applied download behind.
    const infoHash = input.infoHash ?? (await resolveInfoHash(input.urls));
    return this.attachTorrentSource(episodeId, { kind: 'TORRENT_SEARCH', ...input, infoHash }, userId);
  }

  // Magnet pegado a mano por el usuario — mismo flujo que
  // MoviesService.addMagnetToMovie de acá en más, una vez parseado el
  // infoHash del propio magnet.
  async addMagnetToEpisode(episodeId: number, input: { magnet: string; force: boolean }, userId: string) {
    // parseMagnet already throws a keyed BadRequestException (018 T010) — no
    // re-wrap needed, just let it propagate so `extensions.i18n` survives.
    const parsed = parseMagnet(input.magnet);

    return this.attachTorrentSource(
      episodeId,
      {
        kind: 'TORRENT_FILE',
        infoHash: parsed.infoHash,
        urls: [input.magnet],
        releaseTitle: parsed.displayName,
        force: input.force,
      },
      userId,
    );
  }

  // Structural twin of MoviesService.attachTorrentSource
  // (src/movies/movies.service.ts), deliberately not extracted into a shared
  // helper — see 010-episode-acquisition's api/plan.md § Approach for why.
  // Since 022-download-status-tags REQ-7, "already downloading" no longer
  // conflicts at all here (or for a film) — only a COMPLETED target does;
  // `force` going through still means demoting every active row to
  // ERROR *before* creating the replacement — that demotion is what makes a
  // late torrentCompleted for the superseded infoHash harmless.
  private async attachTorrentSource(
    episodeId: number,
    input: { kind: SourceKind; infoHash: string; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    const episode = await this.findOneFromDb(episodeId, userId);
    if (!episode) throw i18nError.notFound(ERROR_KEYS.EPISODE_NOT_FOUND, { id: episodeId });

    const activeSource = await this.findActiveSource(episodeId);

    // REQ-7: only a COMPLETED target refuses. A merely-downloading episode
    // no longer conflicts — REQ-6 makes a second acquisition normal. The
    // `activeSource` query stays: it still drives the demote-on-force block
    // below regardless of the episode's status.
    if (episode.status === 'COMPLETED' && !input.force) {
      throw i18nError.conflict(ERROR_KEYS.EPISODE_ALREADY_COMPLETED);
    }

    // Symmetric with the check MoviesService.attachTorrentSource now does:
    // an infoHash already owned by a movie, or by a *different* episode,
    // must not be silently re-pointed at this one.
    const existingSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash: input.infoHash },
      include: { movie: true },
    });

    if (existingSource && existingSource.movie) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
        title: existingSource.movie.title,
      });
    }

    if (existingSource && existingSource.episodeId && existingSource.episodeId !== episodeId) {
      throw i18nError.conflict(ERROR_KEYS.MAGNET_ALREADY_ATTACHED, {
        title: this.episodeDisplayTitle(episode),
      });
    }

    // El savepath lo decide el client al agregar el torrent, así cada
    // descarga cae en su propia carpeta. Corre antes de cualquier escritura
    // en la DB: si qBittorrent rechaza el torrent no debe quedar ninguna
    // fila QUEUED colgada, ni la fila activa demovida sin reemplazo.
    const downloadPath = await this.qbittorrent.add(input.urls, episodeTags(episode));

    // Demote *before* creating the replacement, and only after qBittorrent
    // has accepted the new torrent — so a rejected add() leaves the
    // previously active source untouched.
    if (activeSource && input.force) {
      await this.prisma.mediaSource.updateMany({
        where: { episodeId, status: { not: 'ERROR' } },
        data: {
          status: 'ERROR',
          errorMessage: MESSAGES_EN[ERROR_KEYS.SOURCE_REPLACED],
          errorKey: ERROR_KEYS.SOURCE_REPLACED,
          errorParams: null,
        },
      });
    }

    const mediaSource = existingSource
      ? await this.prisma.mediaSource.update({
          where: { id: existingSource.id },
          data: {
            kind: input.kind,
            status: 'QUEUED',
            downloadUrl: input.urls[0] ?? null,
            releaseTitle: input.releaseTitle,
            downloadPath,
            errorMessage: null,
            errorKey: null,
            errorParams: null,
            episodeId,
          },
        })
      : await this.prisma.mediaSource.create({
          data: {
            kind: input.kind,
            status: 'QUEUED',
            infoHash: input.infoHash,
            downloadUrl: input.urls[0] ?? null,
            releaseTitle: input.releaseTitle,
            downloadPath,
            episodeId,
          },
        });

    await this.prisma.episode.update({
      where: { id: episodeId },
      data: { status: 'DOWNLOADING' },
    });

    return this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
  }

  // Zero-padded "<Show> S04E01" rendering, matching the prefill format
  // SearchTorrent.tsx builds on the web side. Kept local rather than shared
  // with MoviesService's own copy — see that file's comment.
  private episodeDisplayTitle(episode: {
    episodeNumber: number;
    season: { seasonNumber: number; show: { title: string } };
  }): string {
    const season = String(episode.season.seasonNumber).padStart(2, '0');
    const ep = String(episode.episodeNumber).padStart(2, '0');
    return `${episode.season.show.title} S${season}E${ep}`;
  }
}
