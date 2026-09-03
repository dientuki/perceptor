import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards, Inject, forwardRef } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Setting } from './entities/setting.entity';
import { SettingInput } from './dto/setting.input';
import { QbittorrentClient } from '@/clients/torrent/client';
import { MediaRootsService } from '@/media-roots/media-roots.service';
import { MediaServerIndexService } from '@/media-server-index/media-server-index.service';
import { MEDIA_SERVER_NONE } from '@/clients/media-server/types';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { Public } from '@/auth/decorators/public.decorator';
import { isSupportedLocale } from '@/i18n/locales';
import { SchedulerService } from '@/scheduler/scheduler.service';
import {
  SCHEDULED_TASKS,
  scheduleCronSettingKey,
  scheduleEnabledSettingKey,
} from '@/scheduler/scheduler.registry';

// The eight `schedule_*` keys a settings change re-arms the scheduler for —
// derived from the same registry `SchedulerService.arm()` reads, so a fifth
// task added there is covered here with no edit needed.
const SCHEDULE_SETTING_KEYS = SCHEDULED_TASKS.flatMap((task) => [
  scheduleEnabledSettingKey(task.id),
  scheduleCronSettingKey(task.id),
]);

// The four keys a media-server index rebuild depends on. Only these, and
// only when the submitted entry differs from what was already stored —
// MediaServerFields does not render host/port/apiKey while the client is
// 'none', so those keys are simply absent from a submission made from that
// state, and an absent key must never read as "changed to empty".
const MEDIA_SERVER_CONFIG_KEYS = [
  'media_server_client',
  'media_server_host',
  'media_server_port',
  'media_server_api_key',
];

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
    private readonly mediaServerIndex: MediaServerIndexService,
    @Inject(forwardRef(() => SchedulerService))
    private readonly schedulerService: SchedulerService,
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
    // Captured before the write so the comparison below is against what was
    // actually stored, not against this submission's own values.
    const before = await this.settingsService.getMap();

    // updateMany valida entries ANTES de escribir nada (rechaza rutas que se
    // escapan de la raíz) — recién acá, con la escritura ya confirmada, se
    // avisa a qBittorrent.
    const result = await this.settingsService.updateMany(entries);

    // El save path lo decide la UI, pero el dueño del path es qBittorrent:
    // el api transporta el valor, no lo calcula. Se dispara acá (y no en
    // SettingsService) para no crear un ciclo SettingsService <-> QbittorrentClient.
    // path_downloads se guarda relativo (ver media-roots/): qBittorrent no
    // sabe nada de raíces, así que acá se resuelve a absoluto antes de avisarle.
    const changedDownloadsPath = entries.find(
      (entry) => entry.key === 'path_downloads',
    );
    if (changedDownloadsPath) {
      const absolutePath = await this.mediaRootsService.resolveFromRoot(
        'downloads',
        changedDownloadsPath.value,
      );
      await this.qbittorrentClient.setSavePath(absolutePath);
    }

    // A media-server config change invalidates the local index (034): fire a
    // rebuild, detached, the same "resolver fires the side effect" shape as
    // the downloads-path block above. Only keys actually present in this
    // submission are considered, and only when the value genuinely changed —
    // MediaServerFields omits host/port/apiKey while the client is 'none',
    // so their absence must never read as "changed to empty".
    const mediaServerChanged = entries.some(
      (entry) =>
        MEDIA_SERVER_CONFIG_KEYS.includes(entry.key) &&
        before[entry.key] !== entry.value,
    );
    if (mediaServerChanged) {
      const after = await this.settingsService.getMap();
      const clientId = after.media_server_client;
      if (
        clientId &&
        clientId !== MEDIA_SERVER_NONE &&
        after.media_server_host
      ) {
        void this.mediaServerIndex.rebuild(clientId, {
          host: after.media_server_host,
          port: after.media_server_port,
          apiKey: after.media_server_api_key,
        });
      }
    }

    // REQ-3: a cadence or enable/disable flip must take effect on the next
    // tick, not only after a restart. Re-arm only when a `schedule_*` key
    // genuinely changed — same before/after guard as the two blocks above,
    // so a submission that never touched scheduling does not needlessly
    // replace every armed cron job.
    const scheduleChanged = entries.some(
      (entry) =>
        SCHEDULE_SETTING_KEYS.includes(entry.key) &&
        before[entry.key] !== entry.value,
    );
    if (scheduleChanged) {
      await this.schedulerService.arm();
    }

    return result;
  }
}
