import { ObjectType, Field, ID } from '@nestjs/graphql';
import { Language } from '@/languages/entities/language.entity';

@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  username: string;

  @Field()
  isAdmin: boolean;

  @Field()
  isEnabled: boolean;

  /** BCP-47 language tag. Null means unset — resolve from Accept-Language, then "en". */
  @Field(() => String, { nullable: true })
  uiLocale?: string | null;

  // Resolved on `me` only (AuthResolver's @ResolveField) — never on the
  // admin `users`/`user(id)` queries, by design (011-av1-transcode spec).
  // Optional in TS: nothing that constructs a bare User (UsersService,
  // AuthService.getProfile) populates it — the field resolver supplies it
  // only when a query actually selects it.
  @Field(() => [Language])
  preferredLanguages?: Language[];
}
