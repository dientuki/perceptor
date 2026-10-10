import { TorrentCategory } from '@/clients/torrent/client';

// Spec 088, REQ-10
export interface AttachTarget<T extends { id: number }> {
  resolve(userId: string): Promise<T>;

  // Spec 087, REQ-2; Spec 088, REQ-2
  refuse(target: T, force: boolean): Promise<void>;

  labels(target: T): { tags: string[]; category: TorrentCategory };

  readonly column: 'movieId' | 'episodeId' | 'seasonId';
}
