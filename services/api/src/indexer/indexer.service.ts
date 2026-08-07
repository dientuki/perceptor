import { Injectable } from '@nestjs/common';
import { ProwlarrClient } from '@/clients/indexer/client';

@Injectable()
export class IndexerService {
  constructor(private readonly prowlarr: ProwlarrClient) {}

  // Buscar releases es indistinto para movie o show: la consulta es un string y
  // el resultado tiene la misma forma. De ahí que sea un único método.
  async search(query: string) {
    if (!query.trim()) return [];

    return this.prowlarr.search(query);
  }
}
