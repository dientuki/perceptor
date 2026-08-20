import { InputType, Field } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty } from 'class-validator';

import { ERROR_KEYS } from '@/i18n/error-keys';

@InputType()
export class LoginInput {
  // The `message` option's value is the i18n key itself — see
  // `settings/dto/setting.input.ts` for why (018 REQ-9).
  @Field()
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_LOGIN_USERNAME_REQUIRED })
  username: string;

  @Field()
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_LOGIN_PASSWORD_REQUIRED })
  password: string;

  // `nullable: true` + `defaultValue: false` is what makes this render as
  // `Boolean = false` in the generated SDL, matching the existing
  // `force: Boolean = false` pattern in movies.resolver.ts — `defaultValue`
  // alone renders `Boolean!` (non-null), not the frozen contract's bare
  // `Boolean = false`.
  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsBoolean()
  rememberMe: boolean;
}