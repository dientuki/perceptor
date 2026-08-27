import { Resolver, Query } from '@nestjs/graphql';
import { LanguagesService } from './languages.service';
import { Language } from './entities/language.entity';

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
}
