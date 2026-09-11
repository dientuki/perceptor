import { Resolver, Query } from '@nestjs/graphql';
import { LanguagesService } from './languages.service';
import { Language } from './entities/language.entity';
import { LanguageTrackTitle } from './entities/language-track-title.entity';
import { AllowService } from '@/auth/decorators/allow-service.decorator';

@Resolver(() => Language)
export class LanguagesResolver {
  constructor(private readonly languagesService: LanguagesService) {}

  @Query(() => [Language], {
    name: 'languages',
    description:
      'The full seeded catalog of languages the web pickers read from — never a hard-coded list.',
  })
  async languages() {
    return this.languagesService.findAll();
  }

  @AllowService()
  @Query(() => [LanguageTrackTitle], {
    name: 'trackTitles',
    description:
      'The native-script track title per ISO-639-2/B code, for the worker to burn into a track display name.',
  })
  async trackTitles() {
    return this.languagesService.findTrackTitles();
  }
}
