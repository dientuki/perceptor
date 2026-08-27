import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Setting } from './entities/setting.entity';
import { SettingInput } from './dto/setting.input';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { Public } from '@/auth/decorators/public.decorator';
import { isSupportedLocale } from '@/i18n/locales';

// Guards are applied per method, never at class level: `defaultUiLocale`
// must answer an unauthenticated request (it is read while rendering
// `/login`, before `web` knows who is asking). A class-level `AdminGuard`
// runs even on a method carrying `@Public()` — `@Public()` is read by
// `JwtAuthGuard` only — so it would reach for `req.user` on a request that
// has none (see `ffprobe-logs.resolver.ts` for the same precedent).
@Resolver(() => Setting)
export class SettingsResolver {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly qbittorrentClient: QbittorrentClient,
    private readonly mediaRootsService: MediaRootsService,
  ) {}

  @Public()
  @Query(() => String, { name: 'defaultUiLocale', nullable: true })
  async defaultUiLocale(): Promise<string | null> {
    const map = await this.settingsService.getMap();
    const value = map['ui_locale'];
    return value && isSupportedLocale(value) ? value : null;
  }

  @UseGuards(AdminGuard)
  @Query(() => [Setting], { name: 'settings' })
  async settings() {
    return this.settingsService.findAll();
  }

  @UseGuards(AdminGuard)
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
