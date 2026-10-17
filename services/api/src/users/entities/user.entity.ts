import { ObjectType, Field, ID } from '@nestjs/graphql';

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

  @Field(() => Boolean, {
    nullable: true,
    description:
      'Date order chosen by this user: true = MM/DD/YYYY, false = DD/MM/YYYY. Null means unset — fall through to defaultDateMonthFirst, then the UI language.',
  })
  dateMonthFirst?: boolean | null;

  // `preferredLanguages` used to live here, resolved by AuthResolver's
  // `@ResolveField` — removed by 029-settings-screen-tabs. The per-user
  // global level of that preference is gone; only the per-title level
  // (Movie.preferredLanguages / Show.preferredLanguages) remains.
}
