import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, MinLength } from 'class-validator';

import { ERROR_KEYS } from '@/i18n/error-keys';

@InputType()
export class CreateUserInput {
  // Spec 018, REQ-9
  @Field()
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_USER_NAME_REQUIRED })
  name: string;

  @Field()
  @MinLength(3, { message: ERROR_KEYS.VALIDATION_USERNAME_MIN_LENGTH })
  username: string;

  @Field()
  @MinLength(6, { message: ERROR_KEYS.VALIDATION_PASSWORD_MIN_LENGTH })
  password: string;
}