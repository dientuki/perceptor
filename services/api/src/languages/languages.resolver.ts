import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { LanguagesService } from './languages.service';
import { Language } from './entities/language.entity';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '@/auth/auth.types';

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

  // Always acts on the authenticated user — no user argument by design
  // (011-av1-transcode spec). No @AllowService(): a service principal has
  // no preference of its own to set.
  @Mutation(() => [Language], {
    description: "Replaces the caller's global language preference; [] clears it.",
  })
  async setPreferredLanguages(
    @Args('iso2', { type: () => [String] }) iso2: string[],
    @CurrentUser() principal: AuthPrincipal,
  ): Promise<Language[]> {
    const userId = principal.type === 'user' ? principal.id : '';
    return this.languagesService.setPreferredLanguagesFor(userId, iso2);
  }
}
