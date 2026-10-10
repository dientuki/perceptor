import { Injectable, Logger } from '@nestjs/common';
import { ProwlarrClient } from '@/clients/indexer/client';
import { TorrentResult } from '@/clients/indexer/types';
import { RedisService } from '@/redis/redis.service';
import { RankedTorrentResult, RankingContext, rankTorrentResults } from './ranking';
import { IndexerStatus } from './entities/indexer-status.entity';

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
