// The `Download` shape, hand-copied from
// docs/spec/features/043-pipeline-status-normalization/spec.md § GraphQL
// Contract Delta. There is no codegen across the api/web boundary — this
// type is exactly as wide as the schema, not guessed from usage.
export interface Download {
  mediaSourceId: number;
  // null for a LOCAL_FILE upload racing alongside torrents (REQ-18).
  infoHash: string | null;
  // SourceKind as a plain string — for display only, never for branching.
  // Use `infoHash != null` to decide whether a row is controllable.
  kind: string;
  label: string;
  releaseTitle: string | null;
  movieId: number | null;
  seasonId: number | null;
  episodeId: number | null;
  // Normalized: one of the eight status values, no longer the raw
  // SourceStatus column.
  status: string;
  // Raw qBittorrent state; null when the torrent is not in the client.
  torrentState: string | null;
  // RENAMED from `progress`. 0..100; null when unknown.
  downloadProgress: number | null;
  // 0..100; null when the source has no ProcessJob.
  encodeProgress: number | null;
  // The installation's compression_enabled setting.
  compressionEnabled: boolean;
  // Bytes per second; null when the torrent is not in the client.
  downloadSpeed: number | null;
  readAt: string;
}
