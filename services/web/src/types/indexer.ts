// Espeja la forma que devuelve la query searchTorrents del api (no la del
// cliente interno del indexer, que vive del otro lado del contrato GraphQL).

export type TorrentLink = {
  downloadUrl: string | null;
};

export type TorrentResult = {
  infoHash: string;
  title: string | null;
  size: number | null;
  seeders: number;
  leechers: number;
  items: TorrentLink[];
  infoUrl: TorrentLink[];
};
