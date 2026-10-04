import { Injectable } from '@nestjs/common';
import { SettingsService } from '@/settings/settings.service';
import { MediaCapabilities } from './entities/media-capabilities.entity';
import { MEDIA_TYPE, MediaType } from '@/types/media';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// Spec 045, REQ-11; Spec 045, REQ-10
@Injectable()
export class MediaCapabilitiesService {
  constructor(private readonly settingsService: SettingsService) {}

  // Spec 048, NFR-3
  async read(): Promise<MediaCapabilities> {
    const map = await this.settingsService.getMap();
    const moviesEnabled = this.isEnabledInMap(map, MEDIA_TYPE.MOVIE);
    return {
      moviesEnabled,
      showsEnabled: this.isEnabledInMap(map, MEDIA_TYPE.SHOW),
      shortsEnabled: moviesEnabled && map['shorts_enabled'] === 'true',
      catalogKeyConfigured: (map['movie_db_api_key'] ?? '').trim() !== '',
    };
  }

  async isEnabled(type: MediaType): Promise<boolean> {
    const map = await this.settingsService.getMap();
    return this.isEnabledInMap(map, type);
  }

  // Throws for a disabled type it recognises. A type it does not recognise
  // (a bogus string) returns silently — deciding that a type is unsupported
  // stays MediaDispatchService's job (MEDIA_UNSUPPORTED_TYPE), and duplicating
  // that decision here would produce the wrong error key for a caller that
  // sends garbage.
  async assertEnabled(type: string): Promise<void> {
    if (type !== MEDIA_TYPE.MOVIE && type !== MEDIA_TYPE.SHOW) {
      return;
    }
    const enabled = await this.isEnabled(type);
    if (!enabled) {
      throw i18nError.forbidden(ERROR_KEYS.MEDIA_TYPE_DISABLED, { type });
    }
  }

  // Spec 048, REQ-3 REQ-4
  async isShortsEnabled(): Promise<boolean> {
    const capabilities = await this.read();
    return capabilities.shortsEnabled;
  }

  // Spec 048, REQ-14
  async assertShortsEnabled(): Promise<void> {
    const enabled = await this.isShortsEnabled();
    if (!enabled) {
      throw i18nError.forbidden(ERROR_KEYS.MEDIA_SHORTS_DISABLED);
    }
  }

  async enabledTypes(): Promise<MediaType[]> {
    const capabilities = await this.read();
    const types: MediaType[] = [];
    if (capabilities.moviesEnabled) {
      types.push(MEDIA_TYPE.MOVIE);
    }
    if (capabilities.showsEnabled) {
      types.push(MEDIA_TYPE.SHOW);
    }
    return types;
  }

  // Spec 045, REQ-7
  private isEnabledInMap(map: Record<string, string>, type: MediaType): boolean {
    const key = type === MEDIA_TYPE.MOVIE ? 'movies_enabled' : 'shows_enabled';
    return map[key] !== 'false';
  }
}
