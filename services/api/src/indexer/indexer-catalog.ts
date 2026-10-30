// Spec 112, REQ-1 REQ-2 REQ-5 REQ-6 NFR-2 NFR-9
export type CatalogCategory = 'MOVIES' | 'TV' | 'ANIME';

export interface CatalogEntry {
  definitionName: string;
  name: string;
  language: string | null;
  categories: CatalogCategory[];
  needsFlareSolverr: boolean;
}

export interface SchemaCategory {
  id?: unknown;
  subCategories?: unknown;
}

export interface SchemaField {
  name?: unknown;
  value?: unknown;
}

export interface SchemaEntry {
  definitionName?: unknown;
  name?: unknown;
  language?: unknown;
  privacy?: unknown;
  protocol?: unknown;
  indexerUrls?: unknown;
  capabilities?: { categories?: unknown } | null;
  fields?: unknown;
  [key: string]: unknown;
}

const FLARESOLVERR_FIELD = 'info_flaresolverr';
const ANIME_CATEGORY = 5070;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function collectCategoryIds(categories: unknown[]): number[] {
  const ids: number[] = [];
  for (const category of categories) {
    if (!category || typeof category !== 'object') continue;
    const { id, subCategories } = category as SchemaCategory;
    if (typeof id === 'number') ids.push(id);
    if (Array.isArray(subCategories)) ids.push(...collectCategoryIds(subCategories));
  }
  return ids;
}

function hasFlareSolverrMarker(fields: unknown[]): boolean {
  return fields.some(
    (field) =>
      !!field && typeof field === 'object' && (field as SchemaField).name === FLARESOLVERR_FIELD,
  );
}

export function toCatalogEntry(definition: SchemaEntry | null | undefined): CatalogEntry | null {
  if (!definition || typeof definition !== 'object') return null;
  if (definition.privacy !== 'public') return null;
  if (definition.protocol !== 'torrent') return null;
  if (!isNonEmptyString(definition.definitionName) || !isNonEmptyString(definition.name)) {
    return null;
  }
  const urls = definition.indexerUrls;
  if (!Array.isArray(urls) || !isNonEmptyString(urls[0])) return null;
  const rawCategories = definition.capabilities?.categories;
  if (!Array.isArray(rawCategories) || !Array.isArray(definition.fields)) return null;

  const ids = collectCategoryIds(rawCategories);
  const categories: CatalogCategory[] = [];
  if (ids.some((id) => id >= 2000 && id <= 2999)) categories.push('MOVIES');
  if (ids.some((id) => id >= 5000 && id <= 5999)) categories.push('TV');
  if (categories.length === 0) return null;
  if (ids.includes(ANIME_CATEGORY)) categories.push('ANIME');

  return {
    definitionName: definition.definitionName,
    name: definition.name,
    language: isNonEmptyString(definition.language) ? definition.language : null,
    categories,
    needsFlareSolverr: hasFlareSolverrMarker(definition.fields),
  };
}

export function buildIndexerPayload(
  definition: SchemaEntry,
  options: { appProfileId: number; flareSolverrTagId: number | null },
): Record<string, unknown> {
  const entry = toCatalogEntry(definition);
  if (!entry) {
    throw new Error('buildIndexerPayload called with a definition outside the catalog filter');
  }
  const baseUrl = (definition.indexerUrls as string[])[0];
  const fields = (definition.fields as SchemaField[]).map((field) =>
    field && field.name === 'baseUrl' ? { ...field, value: baseUrl } : field,
  );
  return {
    ...definition,
    fields,
    enable: true,
    appProfileId: options.appProfileId,
    baseUrl,
    tags: entry.needsFlareSolverr && options.flareSolverrTagId !== null
      ? [options.flareSolverrTagId]
      : [],
  };
}
