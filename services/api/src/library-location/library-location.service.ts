import { Injectable, Logger } from '@nestjs/common';
import { MediaServerService } from '@/media-server/media-server.service';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MEDIA_TYPE } from '@/types/media';

export interface LibraryLocateTarget {
  kind: 'movie' | 'episode';
  tmdbId: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

export type LibraryLocateResult =
  | { path: string }
  | { reason: 'no_client' | 'not_held' | 'unavailable' | 'outside_library' };

// Spec 108, REQ-3; Spec 107, REQ-4
@Injectable()
export class LibraryLocationService {
  private readonly logger = new Logger(LibraryLocationService.name);

  constructor(
    private readonly mediaServer: MediaServerService,
    private readonly mediaRoots: MediaRootsService,
  ) {}

  async locate(target: LibraryLocateTarget): Promise<LibraryLocateResult> {
    let hostPath: string | null;
    try {
      const client = await this.mediaServer.createClient();
      if (!client?.mediaHostPath) return { reason: 'no_client' };
      const externalId = await client.findByTmdbId(
        target.kind === 'movie' ? MEDIA_TYPE.MOVIE : MEDIA_TYPE.SHOW,
        target.tmdbId,
      );
      hostPath = externalId
        ? await client.mediaHostPath(
            externalId,
            target.kind === 'episode' ? target.seasonNumber : undefined,
            target.kind === 'episode' ? target.episodeNumber : undefined,
          )
        : null;
    } catch (error) {
      this.logger.warn(
        `Media server read failed while locating ${target.kind} tmdb ${target.tmdbId}: ${String(error)}`,
      );
      return { reason: 'unavailable' };
    }
    if (!hostPath) return { reason: 'not_held' };

    const path = this.mediaRoots.hostToContainerPath('library', hostPath);
    return path ? { path } : { reason: 'outside_library' };
  }
}
