/**
 * The series-level audio/subtitle columns are derived from its episodes and
 * stored. If the rule drifts (counts season 0, counts an unread episode, uses
 * a union, or keeps a language only most episodes carry) the list view shows a
 * language the series does not fully have, and nothing throws anywhere.
 */
import { intersectEpisodeLanguages, EpisodeLanguages } from './intersect';

const READ = new Date('2026-01-01T00:00:00Z');

const ep = (
  audio: unknown,
  subtitles: unknown,
  over: Partial<EpisodeLanguages> = {},
): EpisodeLanguages => ({
  seasonNumber: 1,
  tracksReadAt: READ,
  fileAudioLanguages: audio,
  fileSubtitleLanguages: subtitles,
  ...over,
});

describe('intersectEpisodeLanguages', () => {
  it('lists only the codes present in all 28 episodes when 25 carry Spanish subtitles', () => {
    const episodes = Array.from({ length: 28 }, (_, i) =>
      ep(['eng'], i < 25 ? ['eng', 'spa'] : ['eng']),
    );
    expect(intersectEpisodeLanguages(episodes)).toEqual({
      audio: ['eng'],
      subtitles: ['eng'],
    });
  });

  it('lists a code once all 28 episodes carry it', () => {
    const episodes = Array.from({ length: 28 }, () =>
      ep(['eng'], ['eng', 'spa']),
    );
    expect(intersectEpisodeLanguages(episodes).subtitles).toEqual([
      'eng',
      'spa',
    ]);
  });

  it('ignores season 0', () => {
    const result = intersectEpisodeLanguages([
      ep(['eng'], ['eng']),
      ep([], [], { seasonNumber: 0 }),
    ]);
    expect(result).toEqual({ audio: ['eng'], subtitles: ['eng'] });
  });

  it('ignores an episode whose tracks were never read', () => {
    const result = intersectEpisodeLanguages([
      ep(['eng'], ['eng']),
      ep(null, null, { tracksReadAt: null }),
    ]);
    expect(result).toEqual({ audio: ['eng'], subtitles: ['eng'] });
  });

  it('reads null for both when no episode is in scope', () => {
    expect(intersectEpisodeLanguages([])).toEqual({
      audio: null,
      subtitles: null,
    });
    expect(
      intersectEpisodeLanguages([
        ep(['eng'], ['eng'], { seasonNumber: 0 }),
        ep(['eng'], ['eng'], { tracksReadAt: null }),
      ]),
    ).toEqual({ audio: null, subtitles: null });
  });

  it('returns an empty list when in-scope episodes share no code', () => {
    const result = intersectEpisodeLanguages([
      ep(['eng'], ['eng']),
      ep(['jpn'], ['spa']),
    ]);
    expect(result).toEqual({ audio: [], subtitles: [] });
  });

  it('counts a non-array list on an in-scope episode as empty', () => {
    const result = intersectEpisodeLanguages([
      ep(['eng'], ['eng']),
      ep(null, 'oops'),
    ]);
    expect(result).toEqual({ audio: [], subtitles: [] });
  });

  it('sorts the output alphabetically', () => {
    const result = intersectEpisodeLanguages([
      ep(['spa', 'eng', 'jpn'], ['spa', 'eng']),
      ep(['jpn', 'spa', 'eng'], ['eng', 'spa']),
    ]);
    expect(result).toEqual({
      audio: ['eng', 'jpn', 'spa'],
      subtitles: ['eng', 'spa'],
    });
  });
});
