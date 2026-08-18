// A season block: "S01" followed by one or more chained "E<digits>" groups,
// so a multi-episode name like "S01E01E02" is captured as one block with two
// episode numbers rather than missed entirely.
const SEASON_BLOCK = /s(\d{1,2})((?:e\d{1,3})+)/gi;
const EPISODE_NUMBER = /e(\d{1,3})/gi;

export type ParsedEpisode = {
  seasonNumber: number;
  episodeNumber: number;
};

// The caller must pass a file name (basename), never a path. A season-pack
// download is typically a folder like "Show S02 COMPLETE" holding every
// episode's file — if this regex ran against the full path, every file
// inside that folder would parse as S02, regardless of its own name, and a
// season pack would file every episode under the folder's season number
// instead of its own. Only the file's own base name may carry the truth.
export function parseEpisode(fileName: string): ParsedEpisode | null {
  const blocks = [...fileName.matchAll(SEASON_BLOCK)];
  if (blocks.length === 0) return null;

  const pairs = new Set<string>();
  for (const block of blocks) {
    const seasonNumber = Number(block[1]);
    const episodeNumbers = [...block[2].matchAll(EPISODE_NUMBER)].map((m) => Number(m[1]));
    for (const episodeNumber of episodeNumbers) {
      pairs.add(`${seasonNumber}x${episodeNumber}`);
    }
  }

  if (pairs.size !== 1) return null;

  const [seasonNumber, episodeNumber] = [...pairs][0].split('x').map(Number);
  return { seasonNumber, episodeNumber };
}
