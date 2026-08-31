import { Resolver, Query, Mutation } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { MediaServerOption } from './entities/media-server-option.entity';
import { MediaServerIndexStatus } from './entities/media-server-index-status.entity';
import { MEDIA_SERVER_OPTIONS } from '@/clients/media-server/registry';
import { MEDIA_SERVER_NONE } from '@/clients/media-server/types';
import { MediaServerIndexService } from '@/media-server-index/media-server-index.service';
import { SettingsService } from '@/settings/settings.service';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// Guards are applied per method, never at class level (ffprobe-logs.resolver.ts
// precedent): mediaServerClients must stay unguarded — it feeds the Settings
// combo before an admin has necessarily configured anything.
@Resolver(() => MediaServerOption)
export class MediaServerResolver {
  constructor(
    private readonly settings: SettingsService,
    private readonly index: MediaServerIndexService,
  ) {}

  @Query(() => [MediaServerOption], {
    name: 'mediaServerClients',
    description:
      'Media servers soportados, derivados del registro de clientes — la UI arma el combo con esto en vez de hardcodear las opciones.',
  })
  mediaServerClients() {
    return MEDIA_SERVER_OPTIONS;
  }

  @UseGuards(AdminGuard)
  @Query(() => MediaServerIndexStatus, { name: 'mediaServerIndexStatus' })
  async mediaServerIndexStatus(): Promise<MediaServerIndexStatus> {
    const snapshot = await this.index.readState();
    return {
      state: snapshot.state,
      itemCount: snapshot.itemCount,
      syncedAt: snapshot.syncedAt ?? undefined,
    };
  }

  @UseGuards(AdminGuard)
  @Mutation(() => MediaServerIndexStatus, { name: 'resyncMediaServerIndex' })
  async resyncMediaServerIndex(): Promise<MediaServerIndexStatus> {
    const config = await this.settings.getMap();
    const clientId = config.media_server_client;

    if (
      !clientId ||
      clientId === MEDIA_SERVER_NONE ||
      !config.media_server_host
    ) {
      throw i18nError.badRequest(ERROR_KEYS.MEDIA_SERVER_NOT_CONFIGURED);
    }

    // Never awaited (NFR-6): the mutation answers with whatever state holds
    // right now, not after the rebuild finishes. rebuild() is itself a
    // try/catch/finally, so nothing here can turn into an unhandled
    // rejection.
    void this.index.rebuild(clientId, {
      host: config.media_server_host,
      port: config.media_server_port,
      apiKey: config.media_server_api_key,
    });

    return this.mediaServerIndexStatus();
  }
}
