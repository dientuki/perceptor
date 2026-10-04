import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

import { ERROR_KEYS } from '@/i18n/error-keys';

@InputType()
export class SettingInput {
  // Spec 018, REQ-9
  @Field()
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_SETTING_KEY_REQUIRED })
  key: string;

  // Spec 029, REQ-7
  @Field()
  @IsString({ message: ERROR_KEYS.VALIDATION_SETTING_VALUE_REQUIRED })
  value: string;
}
