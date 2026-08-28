// The `Download` shape, hand-copied from
// docs/spec/features/022-download-status-tags/spec.md § GraphQL Contract
// Delta. There is no codegen across the api/web boundary — this type is
// exactly as wide as the schema, not guessed from usage.
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
  status: string;
  // Raw qBittorrent state; null when the torrent is not in the client.
  torrentState: string | null;
  // 0..100; null when the torrent is not in the client.
  progress: number | null;
  // Bytes per second; null when the torrent is not in the client.
  downloadSpeed: number | null;
  readAt: string;
}
