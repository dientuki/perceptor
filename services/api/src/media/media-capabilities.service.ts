import { Injectable } from '@nestjs/common';
import { SettingsService } from '@/settings/settings.service';
import { MediaCapabilities } from './entities/media-capabilities.entity';
import { MEDIA_TYPE, MediaType } from '@/types/media';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// The one place `movies_enabled` / `shows_enabled` get read as booleans —
// everything downstream of registration (library listings, acquisition
// mutations, worker jobs) never calls this (045-media-type-availability
// spec.md § REQ-11). `assertEnabled` is the enforcement half of REQ-10;
// `read()`/`enabledTypes()` back the `mediaCapabilities` query and the
// `searchAllMedia` narrowing respectively.
@Injectable()
export class MediaCapabilitiesService {
  constructor(private readonly settingsService: SettingsService) {}

  async read(): Promise<MediaCapabilities> {
    const map = await this.settingsService.getMap();
    return {
      moviesEnabled: this.isEnabledInMap(map, MEDIA_TYPE.MOVIE),
      showsEnabled: this.isEnabledInMap(map, MEDIA_TYPE.SHOW),
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

  // REQ-7 / ../plan.md § Risks: an absent row must read as enabled, never
  // `=== 'true'` — that reads a hand-edited or pre-seed install as fully
  // switched off with no error anywhere. Same idiom as
  // process-jobs.service.ts:42 / downloads.service.ts:90 for
  // `compression_enabled`.
  private isEnabledInMap(map: Record<string, string>, type: MediaType): boolean {
    const key = type === MEDIA_TYPE.MOVIE ? 'movies_enabled' : 'shows_enabled';
    return map[key] !== 'false';
  }
}
