import { ObjectType, Field, Int } from '@nestjs/graphql';
import { SubtitleEmbedStatus } from './subtitle-embed-status.enum';

// Spec 101, REQ-17
@ObjectType()
export class SubtitleEmbed {
  @Field(() => Int)
  id: number;

  @Field(() => SubtitleEmbedStatus)
  status: SubtitleEmbedStatus;

  @Field(() => String, {
    nullable: true,
    description: 'i18n key of the failure when status is FAILED, else null.',
  })
  errorKey: string | null;

  @Field(() => String, {
    nullable: true,
    description:
      'i18n key of a non-fatal problem when status is COMPLETED (REQ-12), else null.',
  })
  warningKey: string | null;

  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  finishedAt: Date | null;
}
