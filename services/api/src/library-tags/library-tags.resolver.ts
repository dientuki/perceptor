import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AllowService } from '@/auth/decorators/allow-service.decorator';
import { CurrentUser } from '@/auth/decorators/current-user.decorator';
import { AdminGuard } from '@/auth/guards/admin.guard';
import type { AuthPrincipal } from '@/auth/auth.types';
import { i18nError } from '@/i18n/i18n-error';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { LibraryTagsService } from './library-tags.service';
import { LibraryTagOutcome } from './entities/library-tag-enums';
import {
  LibraryTagMigration,
  LibraryTagMigrationItemDetails,
} from './entities/library-tag-migration.entity';

const requireService = (principal: AuthPrincipal) => {
  if (principal.type !== 'service') {
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }
};

// Spec 123, REQ-12 REQ-18
@Resolver()
export class LibraryTagsResolver {
  constructor(private readonly service: LibraryTagsService) {}

  @UseGuards(AdminGuard)
  @Query(() => LibraryTagMigration, {
    name: 'libraryTagMigration',
    nullable: true,
    description:
      'Latest migration, running or finished; null if none ever ran. Admin only.',
  })
  libraryTagMigration() {
    return this.service.latest();
  }

  @AllowService()
  @Query(() => LibraryTagMigrationItemDetails, {
    name: 'libraryTagMigrationItem',
    description:
      'Worker only (service token). Claims the item: from this call until its outcome is reported, the title reads busy (REQ-17).',
  })
  libraryTagMigrationItem(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    requireService(principal);
    return this.service.claim(id);
  }

  @UseGuards(AdminGuard)
  @Mutation(() => LibraryTagMigration, {
    name: 'startLibraryTagMigration',
    description:
      'Admin only. Starts a walk over every known library file (REQ-12/13).',
  })
  startLibraryTagMigration() {
    return this.service.start();
  }

  @AllowService()
  @Mutation(() => Boolean, {
    name: 'libraryTagMigrationItemFinished',
    description:
      'Worker only. Idempotent: a repeated report for the same item is acknowledged and ignored.',
  })
  libraryTagMigrationItemFinished(
    @Args('id', { type: () => Int }) id: number,
    @Args('outcome', { type: () => LibraryTagOutcome })
    outcome: LibraryTagOutcome,
    @Args('reasonKey', { type: () => String, nullable: true })
    reasonKey: string | null | undefined,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    requireService(principal);
    return this.service.finish(id, outcome, reasonKey ?? null);
  }
}
