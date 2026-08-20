import { Injectable } from '@nestjs/common';
import { MoviesService } from '@/movies/movies.service';
import { ShowsService } from '@/shows/shows.service';
import { MediaTypeService } from './media-type.interface';
import { MEDIA_TYPE, MediaType } from '@/types/media';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';

// The boundary that turns a media type into a choice of service. Nothing
// media-type-specific lives here beyond the lookup table itself — adding a
// third type is one new entry, with no edit to resolve() (spec.md § AC-16).
@Injectable()
export class MediaDispatchService {
  private readonly services: Partial<Record<MediaType, MediaTypeService>>;

  constructor(
    private readonly moviesService: MoviesService,
    private readonly showsService: ShowsService,
  ) {
    this.services = {
      [MEDIA_TYPE.MOVIE]: this.moviesService,
      [MEDIA_TYPE.SHOW]: this.showsService,
    };
  }

  // The only user-facing string that lives above the per-type services —
  // everything else (catalog-miss messages, validation errors) is owned by
  // the service itself.
  resolve(type: string): MediaTypeService {
    const service = this.services[type as MediaType];
    if (!service) {
      throw i18nError.badRequest(ERROR_KEYS.MEDIA_UNSUPPORTED_TYPE, { type });
    }
    return service;
  }
}
