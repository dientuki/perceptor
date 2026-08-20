import { CreateUserInput } from './create-user.input';
import { InputType, Field, PartialType, ID } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';

import { ERROR_KEYS } from '@/i18n/error-keys';

@InputType()
export class UpdateUserInput extends PartialType(CreateUserInput) {
  // A field with no class-validator decorator at all is invisible to
  // ValidationPipe's whitelist: true (main.ts) — it gets silently stripped
  // before the resolver ever sees it, and every write ends up targeting
  // `id: undefined`. Pre-existing bug from 003-auth-user-management,
  // surfaced here because it made every updateUser call (including the new
  // disable safeguards) fail before this fix.
  //
  // The `message` option's value is the i18n key itself — see
  // `setting.input.ts` for why (018 REQ-9).
  @Field(() => ID)
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_USER_ID_REQUIRED })
  id: string;

  // Declared directly on this class, not inherited through PartialType(CreateUserInput):
  // that placement is what keeps isEnabled off CreateUserInput (004-user-disable).
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}