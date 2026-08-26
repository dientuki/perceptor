import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, MinLength } from 'class-validator';

import { ERROR_KEYS } from '@/i18n/error-keys';

// Deliberately not `extends CreateUserInput` and not a `PartialType` of
// `UpdateUserInput` — the admin input carries `id`/`isEnabled`, and a
// self-service mutation that accepted either would be a privilege-escalation
// hole shaped like reuse (`020-profile-edit` spec.md § Context & Goal).
@InputType()
export class UpdateProfileInput {
  @Field()
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_USER_NAME_REQUIRED })
  name: string;

  @Field()
  @MinLength(3, { message: ERROR_KEYS.VALIDATION_USERNAME_MIN_LENGTH })
  username: string;

  // `@IsOptional()` only skips validation for `undefined`/`null` — an empty
  // string still hits `@MinLength(6)` and is rejected, which is what stops a
  // blank input from silently hashing `""` into the row.
  @Field(() => String, { nullable: true })
  @IsOptional()
  @MinLength(6, { message: ERROR_KEYS.VALIDATION_PASSWORD_MIN_LENGTH })
  password?: string;
}
