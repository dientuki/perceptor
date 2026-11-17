export interface EpisodeLanguages {
  seasonNumber: number;
  tracksReadAt: Date | null;
  fileAudioLanguages: unknown;
  fileSubtitleLanguages: unknown;
}

export interface SeriesLanguages {
  audio: string[] | null;
  subtitles: string[] | null;
}

const asCodes = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((code): code is string => typeof code === 'string')
    : [];

const commonCodes = (lists: string[][]): string[] => {
  const [first, ...rest] = lists;
  const shared = new Set(first);
  for (const list of rest) {
    const present = new Set(list);
    for (const code of shared) {
      if (!present.has(code)) shared.delete(code);
    }
  }
  return [...shared].sort();
};

// Spec 117, REQ-7
export function intersectEpisodeLanguages(
  episodes: EpisodeLanguages[],
): SeriesLanguages {
  const inScope = episodes.filter(
    (episode) => episode.seasonNumber !== 0 && episode.tracksReadAt !== null,
  );
  if (inScope.length === 0) return { audio: null, subtitles: null };
  return {
    audio: commonCodes(inScope.map((e) => asCodes(e.fileAudioLanguages))),
    subtitles: commonCodes(
      inScope.map((e) => asCodes(e.fileSubtitleLanguages)),
    ),
  };
}
