import { Injectable, Logger } from '@nestjs/common';
import { IndexerHttpError, ProwlarrClient } from '@/clients/indexer/client';
import { ProwlarrIndexer, TorrentResult } from '@/clients/indexer/types';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';
import { RedisService } from '@/redis/redis.service';
import { RankedTorrentResult, RankingContext, rankTorrentResults } from './ranking';
import { IndexerStatus } from './entities/indexer-status.entity';
import { buildIndexerPayload, CatalogEntry, toCatalogEntry } from './indexer-catalog';

const INDEXER_CATALOG_KEY = 'indexer:catalog';
const INDEXER_CATALOG_TTL_SECONDS = 60 * 60 * 6;
const FLARESOLVERR_TAG_LABEL = 'flaresolverr';
const LOG_DETAIL_MAX = 300;

// Spec 112, REQ-4
export interface ConfiguredIndexer {
  id: number;
  name: string;
  definitionName: string;
  enabled: boolean;
  usesFlareSolverr: boolean;
}

export interface CatalogItem extends CatalogEntry {
  configured: boolean;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

const INDEXER_SEARCH_TTL_SECONDS = 60 * 10;

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function cacheKeyFor(query: string): string {
  return `indexer:search:${normalizeQuery(query)}`;
}

@Injectable()
export class IndexerService {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    private readonly prowlarr: ProwlarrClient,
    private readonly redis: RedisService,
  ) {}

  // Spec 078, NFR-2
  async status(): Promise<IndexerStatus> {
    try {
      const count = await this.prowlarr.countIndexers();
      return { configuredIndexers: count, reachable: true };
    } catch (err) {
      this.logger.error('Failed to reach the indexer for indexerStatus', err as Error);
      return { configuredIndexers: 0, reachable: false };
    }
  }

  // Spec 112, REQ-1 REQ-3 REQ-4
  async catalog(search?: string | null): Promise<CatalogItem[]> {
    const entries = await this.readCatalogProjection();
    const held = new Set(
      (await this.prowlarr.listIndexers())
        .map((indexer) => indexer.definitionName)
        .filter((name): name is string => typeof name === 'string'),
    );
    const needle = search?.trim().toLowerCase() ?? '';
    return entries
      .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
      .map((entry) => ({ ...entry, configured: held.has(entry.definitionName) }))
      .sort(byName);
  }

  // Spec 112, REQ-4
  async configured(): Promise<ConfiguredIndexer[]> {
    const [indexers, tags] = await Promise.all([
      this.prowlarr.listIndexers(),
      this.prowlarr.listTags(),
    ]);
    const tagId = tags.find((tag) => tag.label === FLARESOLVERR_TAG_LABEL)?.id ?? null;
    return indexers.map((indexer) => this.toConfigured(indexer, tagId)).sort(byName);
  }

  // Spec 112, REQ-5 REQ-6 REQ-8
  async add(definitionName: string): Promise<ConfiguredIndexer> {
    const schema = await this.prowlarr.getIndexerSchema();
    const definition = schema.find((entry) => entry?.definitionName === definitionName);
    const entry = toCatalogEntry(definition);
    if (!definition || !entry) {
      throw i18nError.badRequest(ERROR_KEYS.INDEXER_DEFINITION_NOT_ALLOWED);
    }

    const existing = (await this.prowlarr.listIndexers()).find(
      (indexer) => indexer.definitionName === definitionName,
    );
    const tags = await this.prowlarr.listTags();
    const tagId = tags.find((tag) => tag.label === FLARESOLVERR_TAG_LABEL)?.id ?? null;
    if (existing) return this.toConfigured(existing, tagId);

    if (entry.needsFlareSolverr && tagId === null) {
      throw i18nError.badRequest(ERROR_KEYS.INDEXER_FLARESOLVERR_MISSING);
    }

    const profiles = await this.prowlarr.listAppProfiles();
    if (profiles.length === 0) {
      throw i18nError.serviceUnavailable(ERROR_KEYS.INDEXER_UNAVAILABLE);
    }

    const payload = buildIndexerPayload(definition, {
      appProfileId: profiles[0].id,
      flareSolverrTagId: tagId,
    });

    try {
      return this.toConfigured(await this.prowlarr.createIndexer(payload), tagId);
    } catch (err) {
      if (err instanceof IndexerHttpError && err.upstreamStatus === 400) {
        this.logger.warn(
          `Indexer "${definitionName}" failed its connection test: ${err.detail.slice(0, LOG_DETAIL_MAX)}`,
        );
        throw i18nError.badRequest(ERROR_KEYS.INDEXER_TEST_FAILED);
      }
      throw err;
    }
  }

  // Spec 112, REQ-7
  async remove(id: number): Promise<boolean> {
    const indexers = await this.prowlarr.listIndexers();
    if (!indexers.some((indexer) => indexer.id === id)) {
      throw i18nError.notFound(ERROR_KEYS.INDEXER_NOT_FOUND);
    }
    try {
      await this.prowlarr.deleteIndexer(id);
    } catch (err) {
      if (err instanceof IndexerHttpError && err.upstreamStatus === 404) {
        throw i18nError.notFound(ERROR_KEYS.INDEXER_NOT_FOUND);
      }
      throw err;
    }
    return true;
  }

  private toConfigured(indexer: ProwlarrIndexer, flareTagId: number | null): ConfiguredIndexer {
    return {
      id: indexer.id,
      name: typeof indexer.name === 'string' ? indexer.name : '',
      definitionName: typeof indexer.definitionName === 'string' ? indexer.definitionName : '',
      enabled: indexer.enable !== false,
      usesFlareSolverr:
        flareTagId !== null && Array.isArray(indexer.tags) && indexer.tags.includes(flareTagId),
    };
  }

  private async readCatalogProjection(): Promise<CatalogEntry[]> {
    try {
      const raw = await this.redis.get(INDEXER_CATALOG_KEY);
      if (raw !== null) return JSON.parse(raw) as CatalogEntry[];
    } catch (err) {
      console.error(`Error reading indexer catalog cache (${INDEXER_CATALOG_KEY}):`, err);
    }
    const entries = (await this.prowlarr.getIndexerSchema())
      .map((definition) => toCatalogEntry(definition))
      .filter((entry): entry is CatalogEntry => entry !== null);
    try {
      await this.redis.set(
        INDEXER_CATALOG_KEY,
        JSON.stringify(entries),
        'EX',
        INDEXER_CATALOG_TTL_SECONDS,
      );
    } catch (err) {
      console.error(`Error writing indexer catalog cache (${INDEXER_CATALOG_KEY}):`, err);
    }
    return entries;
  }

  async search(query: string): Promise<TorrentResult[]> {
    if (!query.trim()) return [];

    const key = cacheKeyFor(query);

    const cached = await this.readCache(key);
    if (cached !== undefined) return cached;

    const results = await this.prowlarr.search(query);

    void this.writeCache(key, results);

    return results;
  }

  async searchRanked(query: string, context: RankingContext): Promise<RankedTorrentResult[]> {
    return rankTorrentResults(await this.search(query), context);
  }

  private async readCache(key: string): Promise<TorrentResult[] | undefined> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return undefined;
      return JSON.parse(raw) as TorrentResult[];
    } catch (err) {
      console.error(`Error reading indexer search cache (${key}):`, err);
      return undefined;
    }
  }

  private async writeCache(key: string, results: TorrentResult[]): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(results), 'EX', INDEXER_SEARCH_TTL_SECONDS);
    } catch (err) {
      console.error(`Error writing indexer search cache (${key}):`, err);
    }
  }
}
