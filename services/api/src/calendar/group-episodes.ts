import { PipelineStatus } from '@/pipeline-status/pipeline-status';

export type CalendarEpisodeRow = {
  showId: number;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string | null;
  releaseDate: Date;
  status: PipelineStatus;
};

export type EpisodeGroup = {
  showId: number;
  showTitle: string;
  date: string;
  seasonNumber: number;
  firstEpisodeNumber: number;
  lastEpisodeNumber: number;
  episodeCount: number;
  completedCount: number;
  episodeTitle: string | null;
  status: PipelineStatus;
};

const IN_PROGRESS_ASCENDING: PipelineStatus[] = [
  'QUEUED',
  'PAUSED',
  'DOWNLOADING',
  'DOWNLOADED',
  'ENCODING',
];

export function groupStatus(statuses: PipelineStatus[]): PipelineStatus {
  if (statuses.includes('ERROR')) return 'ERROR';
  for (let i = IN_PROGRESS_ASCENDING.length - 1; i >= 0; i--) {
    if (statuses.includes(IN_PROGRESS_ASCENDING[i])) {
      return IN_PROGRESS_ASCENDING[i];
    }
  }
  if (statuses.length > 0 && statuses.every((s) => s === 'COMPLETED')) {
    return 'COMPLETED';
  }
  return 'MISSING';
}

export function groupEpisodes(rows: CalendarEpisodeRow[]): EpisodeGroup[] {
  const buckets = new Map<string, CalendarEpisodeRow[]>();
  for (const row of rows) {
    const date = row.releaseDate.toISOString().slice(0, 10);
    const key = `${row.showId}|${row.seasonNumber}|${date}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return [...buckets.values()].map((members) => {
    const numbers = members.map((m) => m.episodeNumber);
    const first = members[0];
    return {
      showId: first.showId,
      showTitle: first.showTitle,
      date: first.releaseDate.toISOString().slice(0, 10),
      seasonNumber: first.seasonNumber,
      firstEpisodeNumber: Math.min(...numbers),
      lastEpisodeNumber: Math.max(...numbers),
      episodeCount: members.length,
      completedCount: members.filter((m) => m.status === 'COMPLETED').length,
      episodeTitle: members.length === 1 ? first.episodeTitle : null,
      status: groupStatus(members.map((m) => m.status)),
    };
  });
}
