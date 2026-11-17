import { ObjectType, Field, Int } from '@nestjs/graphql';

// Spec 103, REQ-10
@ObjectType()
export class SubtitleSyncDetails {
  @Field(() => Int)
  id: number;

  @Field({
    description:
      'Absolute container path of the library .mkv used as the reference.',
  })
  filePath: string;

  @Field({
    description:
      'Absolute container path of the staged candidate, under the downloads root.',
  })
  candidatePath: string;

  // Spec 118, REQ-12
  @Field(() => String, {
    nullable: true,
    description:
      "iso3 of the candidate's language when the variant check must run (118 REQ-12); null means do not run it.",
  })
  variantDetectionIso3: string | null;
}
