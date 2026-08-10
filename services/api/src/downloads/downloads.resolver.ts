import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { DownloadsService } from '@/downloads/downloads.service';
import { AllowService } from '@/auth/decorators/allow-service.decorator';

// Canal de aviso qBittorrent -> api. La lógica de actualizar la DB y encolar
// el job vive en DownloadsService; el resolver sólo delega.
@Resolver()
export class DownloadsResolver {
  constructor(private readonly downloadsService: DownloadsService) {}

  // Called with the machine credential from the qBittorrent AutoRun hook,
  // not the worker — same SERVICE_TOKEN, different caller.
  @AllowService()
  @Mutation(() => String, {
    name: 'torrentCompleted',
    description: 'Aviso del cliente de torrents de que una descarga terminó',
  })
  async torrentCompleted(@Args('infoHash') infoHash: string): Promise<string> {
    return this.downloadsService.handleTorrentCompleted(infoHash);
  }
}
