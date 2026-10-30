import { buildIndexerPayload, SchemaEntry, toCatalogEntry } from './indexer-catalog';

// These tests exist because the catalog filter is the only thing keeping a
// private, semi-private, usenet or non-film/TV definition out of the admin's
// list and out of addIndexer, and a leak there raises no error anywhere: the
// indexer is simply offered and saved. The payload tests defend a second
// silent failure: a Cloudflare-fronted definition saved without the
// flaresolverr tag is accepted by Prowlarr but every search through it returns
// nothing. Fixtures are invented definitions only.

function definition(overrides: Partial<SchemaEntry> = {}): SchemaEntry {
  return {
    definitionName: 'example-public',
    name: 'Example Public',
    language: 'en-US',
    privacy: 'public',
    protocol: 'torrent',
    indexerUrls: ['https://example.invalid/', 'https://mirror.example.invalid/'],
    capabilities: { categories: [{ id: 2000, name: 'Movies', subCategories: [] }] },
    fields: [
      { name: 'baseUrl', value: null },
      { name: 'other', value: 'default' },
    ],
    ...overrides,
  };
}

describe('toCatalogEntry', () => {
  it('keeps a public torrent film definition and projects only the catalog fields', () => {
    expect(toCatalogEntry(definition())).toEqual({
      definitionName: 'example-public',
      name: 'Example Public',
      language: 'en-US',
      categories: ['MOVIES'],
      needsFlareSolverr: false,
    });
  });

  it('rejects a private definition', () => {
    expect(toCatalogEntry(definition({ privacy: 'private' }))).toBeNull();
  });

  it('rejects a semi-private definition', () => {
    expect(toCatalogEntry(definition({ privacy: 'semiPrivate' }))).toBeNull();
  });

  it('rejects a usenet definition', () => {
    expect(toCatalogEntry(definition({ protocol: 'usenet' }))).toBeNull();
  });

  it('rejects a definition with no film or TV category', () => {
    const caps = { categories: [{ id: 3000, subCategories: [{ id: 3010 }] }] };
    expect(toCatalogEntry(definition({ capabilities: caps }))).toBeNull();
  });

  it('keeps a definition whose film category appears only as a subcategory', () => {
    const caps = { categories: [{ id: 8000, subCategories: [{ id: 2040 }] }] };
    expect(toCatalogEntry(definition({ capabilities: caps }))?.categories).toEqual(['MOVIES']);
  });

  it('reports TV from a 5000-range id', () => {
    const caps = { categories: [{ id: 5030, subCategories: [] }] };
    expect(toCatalogEntry(definition({ capabilities: caps }))?.categories).toEqual(['TV']);
  });

  it('adds ANIME when 5070 is present', () => {
    const caps = { categories: [{ id: 5000, subCategories: [{ id: 5070 }] }] };
    expect(toCatalogEntry(definition({ capabilities: caps }))?.categories).toEqual(['TV', 'ANIME']);
  });

  it('does not report ANIME without 5070', () => {
    const caps = { categories: [{ id: 5000, subCategories: [{ id: 5030 }] }] };
    expect(toCatalogEntry(definition({ capabilities: caps }))?.categories).not.toContain('ANIME');
  });

  it('drops a definition with no indexerUrls', () => {
    expect(toCatalogEntry(definition({ indexerUrls: undefined }))).toBeNull();
    expect(toCatalogEntry(definition({ indexerUrls: [] }))).toBeNull();
  });

  it('drops a definition with no fields', () => {
    expect(toCatalogEntry(definition({ fields: undefined }))).toBeNull();
  });

  it('drops a definition with no capabilities.categories', () => {
    expect(toCatalogEntry(definition({ capabilities: null }))).toBeNull();
  });

  it('drops a definition missing its identifier or name', () => {
    expect(toCatalogEntry(definition({ definitionName: undefined }))).toBeNull();
    expect(toCatalogEntry(definition({ name: 42 }))).toBeNull();
  });

  it('reports a missing language as null', () => {
    expect(toCatalogEntry(definition({ language: undefined }))?.language).toBeNull();
  });

  it('flags the FlareSolverr marker field', () => {
    const fields = [{ name: 'info_flaresolverr', value: null }];
    expect(toCatalogEntry(definition({ fields }))?.needsFlareSolverr).toBe(true);
  });
});

describe('buildIndexerPayload', () => {
  const options = { appProfileId: 7, flareSolverrTagId: 3 };

  it('enables the indexer, sets the profile and takes baseUrl from the first indexerUrls entry', () => {
    const payload = buildIndexerPayload(definition(), options);
    expect(payload.enable).toBe(true);
    expect(payload.appProfileId).toBe(7);
    expect(payload.baseUrl).toBe('https://example.invalid/');
    const baseUrlField = (payload.fields as { name: string; value: unknown }[]).find(
      (f) => f.name === 'baseUrl',
    );
    expect(baseUrlField?.value).toBe('https://example.invalid/');
  });

  it('keeps every other field at the schema default', () => {
    const payload = buildIndexerPayload(definition(), options);
    expect(payload.definitionName).toBe('example-public');
    expect((payload.fields as { name: string; value: unknown }[])[1]).toEqual({
      name: 'other',
      value: 'default',
    });
  });

  it('attaches the flaresolverr tag id to a marked definition', () => {
    const fields = [{ name: 'info_flaresolverr', value: null }];
    expect(buildIndexerPayload(definition({ fields }), options).tags).toEqual([3]);
  });

  it('attaches no tag to an unmarked definition', () => {
    expect(buildIndexerPayload(definition(), options).tags).toEqual([]);
  });

  it('refuses to build a payload for a definition outside the filter', () => {
    expect(() => buildIndexerPayload(definition({ privacy: 'private' }), options)).toThrow();
  });
});
