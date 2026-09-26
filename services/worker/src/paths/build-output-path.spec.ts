// Silent failure defended against: a regression in buildOutputPath files a
// playable file under a subtly different name, the job reports COMPLETED, and
// the library quietly forks into two naming schemes with no error anywhere.
// These cases pin the current Jellyfin layout byte-for-byte, using titles
// verified against the real library.
import { describe, expect, it } from 'vitest';
import { buildOutputPath, type OutputPathInput } from './build-output-path';
import { ERROR_ENCODE_EPISODE_NUMBERS_MISSING } from '../i18n/error-keys';

const movie = (over: Partial<OutputPathInput> = {}): OutputPathInput => ({
  kind: 'MOVIE',
  tmdbId: 1,
  title: 'Title',
  year: 2000,
  seasonNumber: null,
  episodeNumber: null,
  episodeTitle: null,
  outputRoot: '/library/Movies',
  layout: 'jellyfin',
  ...over,
});

const episode = (over: Partial<OutputPathInput> = {}): OutputPathInput => ({
  kind: 'EPISODE',
  tmdbId: 2,
  title: 'Show',
  year: 2010,
  seasonNumber: 1,
  episodeNumber: 2,
  episodeTitle: 'Pilot',
  outputRoot: '/library/Shows',
  layout: 'jellyfin',
  ...over,
});

describe('buildOutputPath (current jellyfin layout)', () => {
  it('strips the colon from "Alita: Battle Angel"', () => {
    expect(buildOutputPath(movie({ title: 'Alita: Battle Angel', year: 2019, tmdbId: 399579 }))).toBe(
      '/library/Movies/Alita Battle Angel (2019) [tmdbid=399579]/Alita Battle Angel (2019).mkv',
    );
  });

  it('strips colon and dash from "X-Men: First Class"', () => {
    expect(buildOutputPath(movie({ title: 'X-Men: First Class', year: 2011, tmdbId: 49538 }))).toBe(
      '/library/Movies/XMen First Class (2011) [tmdbid=49538]/XMen First Class (2011).mkv',
    );
  });

  it("strips the apostrophe from \"Lisey's Story\"", () => {
    const path = buildOutputPath(episode({ title: "Lisey's Story", year: 2021, tmdbId: 90 }));
    expect(path).toBe('/library/Shows/Liseys Story (2021) [tmdbid=90]/Season 01/Liseys Story S01E02 Pilot.mkv');
  });

  it('keeps the ampersand', () => {
    expect(
      buildOutputPath(movie({ title: 'Dungeons & Dragons: Honor Among Thieves', year: 2023, tmdbId: 493529 })),
    ).toBe(
      '/library/Movies/Dungeons & Dragons Honor Among Thieves (2023) [tmdbid=493529]/Dungeons & Dragons Honor Among Thieves (2023).mkv',
    );
  });

  it('keeps the dot', () => {
    expect(buildOutputPath(movie({ title: 'The Super Mario Bros. Movie', year: 2023, tmdbId: 502356 }))).toBe(
      '/library/Movies/The Super Mario Bros. Movie (2023) [tmdbid=502356]/The Super Mario Bros. Movie (2023).mkv',
    );
  });

  it('falls back to (0000) for a film with no year', () => {
    expect(buildOutputPath(movie({ year: null, tmdbId: 7 }))).toBe(
      '/library/Movies/Title (0000) [tmdbid=7]/Title (0000).mkv',
    );
  });

  it('appends the episode title when present', () => {
    expect(buildOutputPath(episode({ episodeTitle: 'Pilot: Part 1' }))).toBe(
      '/library/Shows/Show (2010) [tmdbid=2]/Season 01/Show S01E02 Pilot Part 1.mkv',
    );
  });

  it('omits the episode title segment when there is none', () => {
    expect(buildOutputPath(episode({ episodeTitle: null }))).toBe(
      '/library/Shows/Show (2010) [tmdbid=2]/Season 01/Show S01E02.mkv',
    );
  });

  it('pads season 0 to Season 00', () => {
    expect(buildOutputPath(episode({ seasonNumber: 0, episodeNumber: 3, episodeTitle: null }))).toBe(
      '/library/Shows/Show (2010) [tmdbid=2]/Season 00/Show S00E03.mkv',
    );
  });

  it('throws the keyed error when season and episode numbers are null', () => {
    expect(() => buildOutputPath(episode({ seasonNumber: null, episodeNumber: null }))).toThrow(
      expect.objectContaining({ key: ERROR_ENCODE_EPISODE_NUMBERS_MISSING }),
    );
  });

  it('throws when only the episode number is null', () => {
    expect(() => buildOutputPath(episode({ episodeNumber: null }))).toThrow(
      expect.objectContaining({ key: ERROR_ENCODE_EPISODE_NUMBERS_MISSING }),
    );
  });
});

describe('buildOutputPath (plex layout)', () => {
  const plexMovie = (over: Partial<OutputPathInput> = {}) => movie({ layout: 'plex', ...over });
  const plexEpisode = (over: Partial<OutputPathInput> = {}) => episode({ layout: 'plex', ...over });

  it('tags both folder and file of a film with {tmdb-id}', () => {
    expect(buildOutputPath(plexMovie({ title: 'Alita: Battle Angel', year: 2019, tmdbId: 399579 }))).toBe(
      '/library/Movies/Alita Battle Angel (2019) {tmdb-399579}/Alita Battle Angel (2019) {tmdb-399579}.mkv',
    );
  });

  it('falls back to (0000) for a film with no year', () => {
    expect(buildOutputPath(plexMovie({ year: null, tmdbId: 7 }))).toBe(
      '/library/Movies/Title (0000) {tmdb-7}/Title (0000) {tmdb-7}.mkv',
    );
  });

  it('writes an episode with dash separators and its title', () => {
    expect(
      buildOutputPath(plexEpisode({ title: 'Some Show', year: 2021, tmdbId: 999, episodeTitle: 'The Gold Mine' })),
    ).toBe('/library/Shows/Some Show (2021) {tmdb-999}/Season 01/Some Show - S01E02 - The Gold Mine.mkv');
  });

  it('drops the episode title segment entirely when there is none', () => {
    expect(buildOutputPath(plexEpisode({ episodeTitle: null }))).toBe(
      '/library/Shows/Show (2010) {tmdb-2}/Season 01/Show - S01E02.mkv',
    );
  });

  it('files season 0 under Season 00', () => {
    expect(buildOutputPath(plexEpisode({ seasonNumber: 0, episodeNumber: 3 }))).toBe(
      '/library/Shows/Show (2010) {tmdb-2}/Season 00/Show - S00E03 - Pilot.mkv',
    );
  });

  it('strips dashes from titles so the separators stay unambiguous', () => {
    expect(buildOutputPath(plexEpisode({ title: 'X-Men: First Class', episodeTitle: 'Re-Entry' }))).toBe(
      '/library/Shows/XMen First Class (2010) {tmdb-2}/Season 01/XMen First Class - S01E02 - ReEntry.mkv',
    );
  });

  it('throws when episode numbers are missing', () => {
    expect(() => buildOutputPath(plexEpisode({ seasonNumber: null, episodeNumber: null }))).toThrow(
      expect.objectContaining({ key: ERROR_ENCODE_EPISODE_NUMBERS_MISSING }),
    );
  });
});
