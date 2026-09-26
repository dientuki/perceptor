import { NotFoundException } from '@nestjs/common';

import { RankingContextService } from './ranking-context.service';

// This service decides two things nobody sees fail: whose titles a search
// argument may reach, and which languages arm the ranking. A lookup that
// ignores the caller leaks another user's title through a search argument,
// and a wrong fallback silently unarms the language requirement so every
// ranking quietly ignores it. The lookups are the real ownership-scoped
// services' contract, so the fakes here refuse by user id exactly as
// findOneFromDb does.
const SPANISH = { iso2: 'es', iso3: 'spa' };
const ENGLISH = { iso2: 'en', iso3: 'eng' };
const JAPANESE = { iso2: 'ja', iso3: 'jpn' };

type Prefs = {
  allowCinemaReleases: boolean;
  audioMandatory: boolean;
  audioLanguages: { iso2: string; iso3: string }[];
  movieTorrentGroups: { name: string }[];
  showTorrentGroups: { name: string }[];
};

function prefs(overrides: Partial<Prefs> = {}): Prefs {
  return {
    allowCinemaReleases: false,
    audioMandatory: false,
    audioLanguages: [],
    movieTorrentGroups: [{ name: 'MovieGroup' }],
    showTorrentGroups: [{ name: 'ShowGroup' }],
    ...overrides,
  };
}

function build(options: {
  prefsByUser?: Record<string, Prefs>;
  titleLanguages?: Record<string, { iso2: string; iso3: string }[]>;
  titleMandatory?: Record<string, boolean>;
  owners?: { userId: string; audioMandatory: boolean }[];
}) {
  const prefsByUser = options.prefsByUser ?? { u1: prefs() };
  const titleLanguages = options.titleLanguages ?? {};
  const titleMandatory = options.titleMandatory ?? {};

  const movies = {
    findOneFromDb: jest.fn(async (id: number, userId: string) =>
      userId === 'u1' && id === 10 ? { id } : null,
    ),
    findAudioMandatoryFor: jest.fn(async (userId: string) => titleMandatory[userId] ?? false),
  };
  const shows = {
    findAudioMandatoryFor: jest.fn(async (userId: string) => titleMandatory[userId] ?? false),
  };
  const seasons = {
    findOneFromDb: jest.fn(async (id: number, userId: string) =>
      userId === 'u1' && id === 20 ? { id, show: { id: 5 } } : null,
    ),
  };
  const episodes = {
    findOneFromDb: jest.fn(async (id: number, userId: string) =>
      userId === 'u1' && id === 30 ? { id, season: { show: { id: 5 } } } : null,
    ),
  };
  const preferences = {
    findForUser: jest.fn(async (userId: string) => prefsByUser[userId] ?? prefs()),
  };
  const languages = {
    findMoviePreferredTrackLanguagesFor: jest.fn(
      async (userId: string) => titleLanguages[userId] ?? [],
    ),
    findShowPreferredTrackLanguagesFor: jest.fn(
      async (userId: string) => titleLanguages[userId] ?? [],
    ),
  };
  const prisma = {
    userShow: { findMany: jest.fn(async () => options.owners ?? []) },
  };

  const service = new RankingContextService(
    movies as never,
    shows as never,
    seasons as never,
    episodes as never,
    preferences as never,
    languages as never,
    prisma as never,
  );
  return { service, movies, seasons, episodes, prisma };
}

describe('RankingContextService.forCaller', () => {
  it('refuses a film, season or episode the caller does not hold', async () => {
    const { service } = build({});

    await expect(service.forCaller('u2', { movieId: 10 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.forCaller('u2', { seasonId: 20 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.forCaller('u2', { episodeId: 30 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.forCaller('u1', { movieId: 999 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('asks each ownership lookup on behalf of the caller', async () => {
    const { service, movies, seasons, episodes } = build({});

    await service.forCaller('u1', { movieId: 10 });
    await service.forCaller('u1', { seasonId: 20 });
    await service.forCaller('u1', { episodeId: 30 });

    expect(movies.findOneFromDb).toHaveBeenCalledWith(10, 'u1');
    expect(seasons.findOneFromDb).toHaveBeenCalledWith(20, 'u1');
    expect(episodes.findOneFromDb).toHaveBeenCalledWith(30, 'u1');
  });

  it('falls back to the global languages and flag when the title has none', async () => {
    const { service } = build({
      prefsByUser: { u1: prefs({ audioMandatory: true, audioLanguages: [SPANISH] }) },
      titleMandatory: { u1: false },
    });

    const context = await service.forCaller('u1', { episodeId: 30 });

    expect(context.languageRequirement).toEqual({ mandatory: true, languages: [SPANISH] });
  });

  it('keeps the title own languages and flag when it has some', async () => {
    const { service } = build({
      prefsByUser: { u1: prefs({ audioMandatory: false, audioLanguages: [SPANISH] }) },
      titleLanguages: { u1: [JAPANESE] },
      titleMandatory: { u1: true },
    });

    const context = await service.forCaller('u1', { movieId: 10 });

    expect(context.languageRequirement).toEqual({ mandatory: true, languages: [JAPANESE] });
  });

  it('applies the caller cinema preference only to a film target', async () => {
    const { service } = build({ prefsByUser: { u1: prefs({ allowCinemaReleases: false }) } });

    expect((await service.forCaller('u1', { movieId: 10 })).allowCinemaReleases).toBe(false);
    expect((await service.forCaller('u1', { seasonId: 20 })).allowCinemaReleases).toBe(true);
    expect((await service.forCaller('u1', { episodeId: 30 })).allowCinemaReleases).toBe(true);
    expect((await service.forCaller('u1', null)).allowCinemaReleases).toBe(true);
  });

  it('takes the groups from the scope matching the target kind', async () => {
    const { service } = build({});

    expect((await service.forCaller('u1', { movieId: 10 })).preferredGroups).toEqual(['MovieGroup']);
    expect((await service.forCaller('u1', { episodeId: 30 })).preferredGroups).toEqual(['ShowGroup']);
    expect((await service.forCaller('u1', { seasonId: 20 })).preferredGroups).toEqual(['ShowGroup']);
  });

  it('returns an unarmed context with no groups for a null target', async () => {
    const { service } = build({
      prefsByUser: { u1: prefs({ audioMandatory: true, audioLanguages: [SPANISH] }) },
    });

    expect(await service.forCaller('u1', null)).toEqual({
      languageRequirement: null,
      preferredGroups: [],
      allowCinemaReleases: true,
    });
  });
});

describe('RankingContextService.forShowOwners', () => {
  it('arms on one owner out of three and unions every owner language, mandatory or not', async () => {
    const { service } = build({
      owners: [
        { userId: 'a', audioMandatory: false },
        { userId: 'b', audioMandatory: true },
        { userId: 'c', audioMandatory: false },
      ],
      prefsByUser: {
        a: prefs({ showTorrentGroups: [{ name: 'G1' }] }),
        b: prefs({ showTorrentGroups: [{ name: 'G2' }] }),
        c: prefs({ audioLanguages: [JAPANESE], showTorrentGroups: [{ name: 'G1' }] }),
      },
      titleLanguages: { a: [ENGLISH], b: [SPANISH] },
    });

    const context = await service.forShowOwners(5);

    expect(context.languageRequirement?.mandatory).toBe(true);
    expect(context.languageRequirement?.languages.map((l) => l.iso3).sort()).toEqual([
      'eng',
      'jpn',
      'spa',
    ]);
    expect(context.preferredGroups.sort()).toEqual(['G1', 'G2']);
    expect(context.allowCinemaReleases).toBe(true);
  });

  it('resolves an owner without title languages through their global preference', async () => {
    const { service } = build({
      owners: [{ userId: 'a', audioMandatory: false }],
      prefsByUser: { a: prefs({ audioMandatory: true, audioLanguages: [SPANISH] }) },
    });

    const context = await service.forShowOwners(5);

    expect(context.languageRequirement).toEqual({ mandatory: true, languages: [SPANISH] });
  });

  it('is not armed when no owner required a language', async () => {
    const { service } = build({
      owners: [
        { userId: 'a', audioMandatory: false },
        { userId: 'b', audioMandatory: false },
      ],
      prefsByUser: { a: prefs(), b: prefs({ audioLanguages: [SPANISH] }) },
    });

    const context = await service.forShowOwners(5);

    expect(context.languageRequirement?.mandatory).toBe(false);
  });
});
