import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AdminGuard } from '@/auth/guards/admin.guard';
import { SubtitleProvidersService } from './subtitle-providers.service';
import { SubtitleProviderSettings } from './entities/subtitle-provider.entity';
import { SubtitleProviderKind } from './entities/subtitle-provider-kind.enum';
import {
  SubtitleProviderInput,
  SubtitleProviderLanguageInput,
} from './dto/subtitle-provider.input';

// Spec 121, REQ-3
@Resolver()
export class SubtitleProvidersResolver {
  constructor(private readonly providers: SubtitleProvidersService) {}

  @UseGuards(AdminGuard)
  @Query(() => SubtitleProviderSettings, {
    name: 'subtitleProviders',
    description: 'Admin only.',
  })
  subtitleProviders(): Promise<SubtitleProviderSettings> {
    return this.providers.read();
  }

  @UseGuards(AdminGuard)
  @Mutation(() => SubtitleProviderSettings, {
    name: 'saveSubtitleProvider',
    description: 'Admin only. Adds or edits one provider.',
  })
  saveSubtitleProvider(
    @Args('input') input: SubtitleProviderInput,
  ): Promise<SubtitleProviderSettings> {
    return this.providers.save(input);
  }

  @UseGuards(AdminGuard)
  @Mutation(() => SubtitleProviderSettings, {
    name: 'removeSubtitleProvider',
    description:
      "Admin only. Clears the provider's credentials and drops its languages (REQ-5, REQ-6).",
  })
  removeSubtitleProvider(
    @Args('kind', { type: () => SubtitleProviderKind }) kind: SubtitleProviderKind,
  ): Promise<SubtitleProviderSettings> {
    return this.providers.remove(kind);
  }

  @UseGuards(AdminGuard)
  @Mutation(() => SubtitleProviderSettings, {
    name: 'setSubtitleProviderLanguages',
    description: 'Admin only. Replaces the default and the whole entry set at once.',
  })
  setSubtitleProviderLanguages(
    @Args('defaultProvider', { type: () => SubtitleProviderKind })
    defaultProvider: SubtitleProviderKind,
    @Args('languages', { type: () => [SubtitleProviderLanguageInput] })
    languages: SubtitleProviderLanguageInput[],
  ): Promise<SubtitleProviderSettings> {
    return this.providers.setLanguages(defaultProvider, languages);
  }
}
