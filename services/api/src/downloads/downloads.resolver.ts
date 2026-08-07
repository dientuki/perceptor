import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { DownloadsService } from '@/downloads/downloads.service';

// Canal de aviso qBittorrent -> api. La lógica de actualizar la DB y encolar
// el job vive en DownloadsService; el resolver sólo delega.
@Resolver()
export class DownloadsResolver {
  constructor(private readonly downloadsService: DownloadsService) {}

  @Mutation(() => String, {
    name: 'torrentCompleted',
    description: 'Aviso del cliente de torrents de que una descarga terminó',
  })
  async torrentCompleted(@Args('infoHash') infoHash: string): Promise<string> {
    return this.downloadsService.handleTorrentCompleted(infoHash);
  }
}
