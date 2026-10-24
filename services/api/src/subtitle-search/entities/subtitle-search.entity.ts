import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';

// Spec 103, REQ-13
export enum SubtitleSearchStatus {
  WAITING = 'WAITING',
  SEARCHING = 'SEARCHING',
  VALIDATING = 'VALIDATING',
  EMBEDDING = 'EMBEDDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

registerEnumType(SubtitleSearchStatus, { name: 'SubtitleSearchStatus' });

// Spec 103, REQ-13
export enum SubtitleSearchLanguageOutcome {
  PENDING = 'PENDING',
  ALREADY_PRESENT = 'ALREADY_PRESENT',
  EMBEDDED = 'EMBEDDED',
  NOT_FOUND = 'NOT_FOUND',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

registerEnumType(SubtitleSearchLanguageOutcome, {
  name: 'SubtitleSearchLanguageOutcome',
});

// Spec 103, REQ-10
export enum SubtitleSyncReference {
  SUBTITLE = 'SUBTITLE',
  AUDIO = 'AUDIO',
}

registerEnumType(SubtitleSyncReference, { name: 'SubtitleSyncReference' });

@ObjectType()
export class SubtitleSearchLanguage {
  @Field()
  languageIso3: string;

  @Field(() => SubtitleSearchLanguageOutcome)
  outcome: SubtitleSearchLanguageOutcome;

  @Field(() => String, {
    nullable: true,
    description: 'i18n key when outcome is FAILED or REJECTED, else null.',
  })
  reasonKey: string | null;
}

@ObjectType()
export class SubtitleSearch {
  @Field(() => Int)
  id: number;

  @Field(() => SubtitleSearchStatus)
  status: SubtitleSearchStatus;

  @Field(() => String, {
    nullable: true,
    description: 'i18n key when status is FAILED, else null.',
  })
  errorKey: string | null;

  @Field(() => [SubtitleSearchLanguage])
  languages: SubtitleSearchLanguage[];

  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  finishedAt: Date | null;
}
