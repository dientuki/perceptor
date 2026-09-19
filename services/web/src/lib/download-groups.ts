import type { Download } from "@/types/downloads";

export interface DownloadGroup {
  key: string;
  title: string;
  downloads: Download[];
}

function groupKey(download: Download): string {
  if (download.showId != null) return `show:${download.showId}`;
  if (download.movieId != null) return `movie:${download.movieId}`;
  return `source:${download.mediaSourceId}`;
}

export function groupByTitle(downloads: Download[]): DownloadGroup[] {
  const groups: DownloadGroup[] = [];
  const index = new Map<string, DownloadGroup>();

  for (const download of downloads) {
    const key = groupKey(download);
    const existing = index.get(key);
    if (existing) {
      existing.downloads.push(download);
      continue;
    }
    const group: DownloadGroup = {
      key,
      title: download.showTitle ?? download.label,
      downloads: [download],
    };
    index.set(key, group);
    groups.push(group);
  }

  return groups;
}
