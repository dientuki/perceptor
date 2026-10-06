// One definition of the zero-padded "<Show> SxxEyy" rendering, shared by
// every acquisition path instead of three copies.

// Spec 088, REQ-11
export function episodeDisplayTitle(episode: {
  episodeNumber: number;
  season: { seasonNumber: number; show: { title: string } };
}): string {
  const season = String(episode.season.seasonNumber).padStart(2, '0');
  const ep = String(episode.episodeNumber).padStart(2, '0');
  return `${episode.season.show.title} S${season}E${ep}`;
}
