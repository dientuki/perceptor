import { CreateUserInput } from './create-user.input';
import { InputType, Field, PartialType, ID } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional } from 'class-validator';

import { ERROR_KEYS } from '@/i18n/error-keys';

@InputType()
export class UpdateUserInput extends PartialType(CreateUserInput) {
  // Spec 018, REQ-9
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