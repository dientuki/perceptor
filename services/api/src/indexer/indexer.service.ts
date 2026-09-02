import { Injectable } from '@nestjs/common';
import { ProwlarrClient } from '@/clients/indexer/client';
import { TorrentResult } from '@/clients/indexer/types';
import { RedisService } from '@/redis/redis.service';

const INDEXER_SEARCH_TTL_SECONDS = 60 * 10;

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function cacheKeyFor(query: string): string {
  return `indexer:search:${normalizeQuery(query)}`;
}

@Injectable()
export class IndexerService {
  constructor(
    private readonly prowlarr: ProwlarrClient,
    private readonly redis: RedisService,
  ) {}

  // Buscar releases es indistinto para movie o show: la consulta es un string y
  // el resultado tiene la misma forma. De ahí que sea un único método.
  async search(query: string): Promise<TorrentResult[]> {
    if (!query.trim()) return [];

    const key = cacheKeyFor(query);

    const cached = await this.readCache(key);
    if (cached !== undefined) return cached;

    const results = await this.prowlarr.search(query);

    void this.writeCache(key, results);

    return results;
  }

  private async readCache(key: string): Promise<TorrentResult[] | undefined> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return undefined;
      return JSON.parse(raw) as TorrentResult[];
    } catch (err) {
      console.error(`Error leyendo cache de búsqueda de indexer (${key}):`, err);
      return undefined;
    }
  }

  private async writeCache(key: string, results: TorrentResult[]): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(results), 'EX', INDEXER_SEARCH_TTL_SECONDS);
    } catch (err) {
      console.error(`Error guardando cache de búsqueda de indexer (${key}):`, err);
    }
  }
}
