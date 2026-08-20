import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty } from 'class-validator';

import { ERROR_KEYS } from '@/i18n/error-keys';

@InputType()
export class SettingInput {
  // The `message` option's value is the i18n key itself, not the rendered
  // sentence — `main.ts`'s `exceptionFactory` looks it up in `MESSAGES_EN`
  // (018 REQ-9).
  @Field()
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_SETTING_KEY_REQUIRED })
  key: string;

  @Field()
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_SETTING_VALUE_REQUIRED })
  value: string;
}
