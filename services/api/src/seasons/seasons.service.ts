import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { QbittorrentClient } from '@/clients/torrent/client';
import { parseMagnet } from '@/clients/torrent/magnet';
import { SourceKind } from '@prisma/client';

// Structural twin of EpisodesService (episodes/episodes.service.ts), itself
// a structural twin of MoviesService — the third deliberate copy, not a
// shared helper, see 013-season-pack-processing's api/plan.md § Approach.
// One relation shallower than the episode version: ownership runs through
// season -> show -> UserShow, no episode hop in between. "Already
// downloading" is a query for a non-ERROR MediaSource against this seasonId
// (MediaSource.seasonId, not a unique column), so `force` means demoting
// every such row to ERROR *before* creating the replacement — same ordering
// guarantee as the episode/movie twins, for the same reason.
@Injectable()
export class SeasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qbittorrent: QbittorrentClient,
  ) {}

  async findOneFromDb(id: number, userId: string) {
    return this.prisma.season.findFirst({
      where: { id, show: { users: { some: { userId } } } },
      include: { show: true },
    });
  }

  // Magnet pegado a mano por el usuario — mismo flujo que
  // EpisodesService.addMagnetToEpisode de acá en más, una vez parseado el
  // infoHash del propio magnet.
  async addMagnetToSeason(seasonId: number, input: { magnet: string; force: boolean }, userId: string) {
    let parsed;
    try {
      parsed = parseMagnet(input.magnet);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : String(err));
    }

    return this.attachTorrentSource(
      seasonId,
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

  // Structural twin of EpisodesService.attachTorrentSource, deliberately not
  // extracted into a shared helper — see ../../../docs/spec/features/
  // 013-season-pack-processing/plan.md § Approach for why. The one shape
  // difference: the created/updated MediaSource carries seasonId instead of
  // episodeId, and the conflict/demotion queries are seasonId-scoped.
  private async attachTorrentSource(
    seasonId: number,
    input: { kind: SourceKind; infoHash: string; urls: string[]; releaseTitle: string | null; force: boolean },
    userId: string,
  ) {
    const season = await this.findOneFromDb(seasonId, userId);
    if (!season) throw new NotFoundException(`La temporada ${seasonId} no existe`);

    const activeSource = await this.prisma.mediaSource.findFirst({
      where: { seasonId, status: { not: 'ERROR' } },
    });

    if (activeSource && !input.force) {
      throw new ConflictException(
        'Esta temporada ya tiene una descarga en curso. Confirmá para reemplazarla.',
      );
    }

    // Symmetric with the checks MoviesService/EpisodesService.attachTorrentSource
    // already do: an infoHash already owned by a movie, an episode, or a
    // *different* season must not be silently re-pointed at this one.
    const existingSource = await this.prisma.mediaSource.findUnique({
      where: { infoHash: input.infoHash },
      include: {
        movie: true,
        episode: { include: { season: { include: { show: true } } } },
        season: { include: { show: true } },
      },
    });

    if (existingSource && existingSource.movie) {
      throw new ConflictException(
        `Ese magnet ya está asociado a «${existingSource.movie.title}»`,
      );
    }

    if (existingSource && existingSource.episode) {
      throw new ConflictException(
        `Ese magnet ya está asociado a «${this.episodeDisplayTitle(existingSource.episode)}»`,
      );
    }

    if (existingSource && existingSource.season && existingSource.season.id !== seasonId) {
      throw new ConflictException(
        `Ese magnet ya está asociado a «${this.seasonDisplayTitle(existingSource.season)}»`,
      );
    }

    // El savepath lo decide el client al agregar el torrent, así cada
    // descarga cae en su propia carpeta. Corre antes de cualquier escritura
    // en la DB: si qBittorrent rechaza el torrent no debe quedar ninguna
    // fila QUEUED colgada, ni la fila activa demovida sin reemplazo.
    const downloadPath = await this.qbittorrent.add(input.urls);

    // Demote *before* creating the replacement, and only after qBittorrent
    // has accepted the new torrent — so a rejected add() leaves the
    // previously active source untouched.
    if (activeSource && input.force) {
      await this.prisma.mediaSource.updateMany({
        where: { seasonId, status: { not: 'ERROR' } },
        data: { status: 'ERROR', errorMessage: 'Reemplazado por una nueva descarga' },
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
            seasonId,
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
            seasonId,
          },
        });

    // Season.episodes is non-null on the entity (Season.episodes: [Episode!]!)
    // — a bare row here would fail the mutation *after* the torrent was
    // already accepted, see api/plan.md's "Season returned without its
    // episodes" risk.
    return this.prisma.season.findUniqueOrThrow({
      where: { id: seasonId },
      include: { episodes: { orderBy: { episodeNumber: 'asc' } } },
    });
  }

  // Zero-padded "<Show> S04E01" rendering, matching EpisodesService's own
  // copy. Kept local rather than shared — see that file's comment.
  private episodeDisplayTitle(episode: {
    episodeNumber: number;
    season: { seasonNumber: number; show: { title: string } };
  }): string {
    const season = String(episode.season.seasonNumber).padStart(2, '0');
    const ep = String(episode.episodeNumber).padStart(2, '0');
    return `${episode.season.show.title} S${season}E${ep}`;
  }

  // "<Show> Temporada <n>" rendering, matching the label
  // SeasonAccordion.tsx already shows on the web side.
  private seasonDisplayTitle(season: { seasonNumber: number; show: { title: string } }): string {
    return `${season.show.title} Temporada ${season.seasonNumber}`;
  }
}
