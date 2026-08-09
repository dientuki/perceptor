import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { SettingsService } from './settings.service';
import { Setting } from './entities/setting.entity';
import { SettingInput } from './dto/setting.input';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MediaRootsService } from '@/media-roots/media-roots.service';

@Resolver(() => Setting)
export class SettingsResolver {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly qbittorrentClient: QbittorrentClient,
    private readonly mediaRootsService: MediaRootsService,
  ) {}

  @Query(() => [Setting], { name: 'settings' })
  async settings() {
    return this.settingsService.findAll();
  }

  @Mutation(() => [Setting], { name: 'updateSettings' })
  async updateSettings(
    @Args('entries', { type: () => [SettingInput] }) entries: SettingInput[],
  ) {
    // updateMany valida entries ANTES de escribir nada (rechaza rutas que se
    // escapan de la raíz) — recién acá, con la escritura ya confirmada, se
    // avisa a qBittorrent.
    const result = await this.settingsService.updateMany(entries);

    // El save path lo decide la UI, pero el dueño del path es qBittorrent:
    // el api transporta el valor, no lo calcula. Se dispara acá (y no en
    // SettingsService) para no crear un ciclo SettingsService <-> QbittorrentClient.
    // path_downloads se guarda relativo (ver media-roots/): qBittorrent no
    // sabe nada de raíces, así que acá se resuelve a absoluto antes de avisarle.
    const changedDownloadsPath = entries.find((entry) => entry.key === 'path_downloads');
    if (changedDownloadsPath) {
      const absolutePath = await this.mediaRootsService.resolveFromRoot('downloads', changedDownloadsPath.value);
      await this.qbittorrentClient.setSavePath(absolutePath);
    }

    return result;
  }
}
