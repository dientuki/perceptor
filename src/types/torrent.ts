type TorrentInfo = {
  downloadUrl: string;
  infoHash: string;
};

interface Job {
    id: number;
    media_type: string;
    name: string | null;
    status: string;
    error: string | null;
}