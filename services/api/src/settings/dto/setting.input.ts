import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString } from 'class-validator';

import { ERROR_KEYS } from '@/i18n/error-keys';

@InputType()
export class SettingInput {
  // The `message` option's value is the i18n key itself, not the rendered
  // sentence — `main.ts`'s `exceptionFactory` looks it up in `MESSAGES_EN`
  // (018 REQ-9).
  @Field()
  @IsNotEmpty({ message: ERROR_KEYS.VALIDATION_SETTING_KEY_REQUIRED })
  key: string;

  // Relaxed from @IsNotEmpty() to @IsString() so the empty string can reach
  // `SettingsService.updateMany` (029 REQ-7: `default_languages` must be
  // clearable). The emptiness rule now lives per-kind in the settings
  // catalog rather than field-wide.
  @Field()
  @IsString({ message: ERROR_KEYS.VALIDATION_SETTING_VALUE_REQUIRED })
  value: string;
}
