import { registerEnumType } from '@nestjs/graphql';

export enum LanguageTrackKind {
  AUDIO = 'AUDIO',
  SUBTITLE = 'SUBTITLE',
}

registerEnumType(LanguageTrackKind, {
  name: 'LanguageTrackKind',
  description: 'Which side of the encode a language preference applies to.',
});
