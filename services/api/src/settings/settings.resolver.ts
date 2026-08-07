import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { SettingsService } from './settings.service';
import { Setting } from './entities/setting.entity';
import { SettingInput } from './dto/setting.input';
import { QbittorrentClient } from '@/clients/torrent/client';

@Resolver(() => Setting)
export class SettingsResolver {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly qbittorrentClient: QbittorrentClient,
  ) {}

  @Query(() => [Setting], { name: 'settings' })
  async settings() {
    return this.settingsService.findAll();
  }

  @Mutation(() => [Setting], { name: 'updateSettings' })
  async updateSettings(
    @Args('entries', { type: () => [SettingInput] }) entries: SettingInput[],
  ) {
    const result = await this.settingsService.updateMany(entries);

    // El save path lo decide la UI, pero el dueño del path es qBittorrent:
    // el api transporta el valor, no lo calcula. Se dispara acá (y no en
    // SettingsService) para no crear un ciclo SettingsService <-> QbittorrentClient.
    const changedDownloadsPath = entries.find((entry) => entry.key === 'path_downloads');
    if (changedDownloadsPath) {
      await this.qbittorrentClient.setSavePath(changedDownloadsPath.value);
    }

    return result;
  }
}
