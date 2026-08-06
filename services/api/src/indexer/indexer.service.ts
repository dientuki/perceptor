import { Injectable } from '@nestjs/common';
import { createProwlarrClient } from '@/clients/indexer/client';

@Injectable()
export class IndexerService {
  // Buscar releases es indistinto para movie o show: la consulta es un string y
  // el resultado tiene la misma forma. De ahí que sea un único método.
  async search(query: string) {
    if (!query.trim()) return [];

    // TODO: la config sale de la tabla Setting cuando exista
    const client = createProwlarrClient();
    return client.search(query);
  }
}
