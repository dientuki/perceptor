import { TorrentCategory } from '@/clients/torrent/client';

// The target-aware surface of the unified attach path (AttachSourceService)
// is enumerated and closed to exactly these four members. Nothing else
// inside that service may depend on whether the target is a film, an
// episode or a season — a fifth member here, or a per-target branch
// anywhere in AttachSourceService itself, is a defect, not an extension.

// Spec 088, REQ-10
export interface AttachTarget<T extends { id: number }> {
  // (a) Resolve the target and authorize the caller against it. Throws the
  // target's own not_found key when the row does not exist or the caller
  // does not own it — the two are deliberately indistinguishable.
  resolve(userId: string): Promise<T>;

  // (b) The refusal set: the delivered/COMPLETED guard, which for a season
  // is a count of its COMPLETED episodes rather than a status column of its
  // own. Throws the target's own already_completed key unless `force` is
  // true. The conflict scope (a colliding infoHash already on a different
  // movie/episode/season) is generic and lives in AttachSourceService
  // itself — it does not belong here.

  // Spec 087, REQ-2; Spec 088, REQ-2
  refuse(target: T, force: boolean): Promise<void>;

  // (c) The tag list and category handed to the torrent client.
  labels(target: T): { tags: string[]; category: TorrentCategory };

  // (d) Which column of MediaSource this target's row carries.
  readonly column: 'movieId' | 'episodeId' | 'seasonId';
}
