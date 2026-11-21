import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { LibraryTagMigrationStatus } from './library-tag-enums';

// Spec 123, REQ-18
@ObjectType()
export class LibraryTagMigrationFailure {
  @Field(() => String, {
    description: 'Host-side path, never the container path.',
  })
  path: string;

  @Field(() => String, { description: 'i18n key.' })
  reasonKey: string;
}

// Spec 123, REQ-12 REQ-18
@ObjectType()
export class LibraryTagMigration {
  @Field(() => Int)
  id: number;

  @Field(() => LibraryTagMigrationStatus)
  status: LibraryTagMigrationStatus;

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  processed: number;

  @Field(() => Int)
  migrated: number;

  @Field(() => Int)
  unchanged: number;

  @Field(() => Int)
  busy: number;

  @Field(() => Int)
  missing: number;

  @Field(() => Int)
  failed: number;

  @Field(() => [LibraryTagMigrationFailure])
  failures: LibraryTagMigrationFailure[];

  @Field()
  startedAt: Date;

  @Field(() => Date, { nullable: true })
  finishedAt: Date | null;
}

// Spec 123, REQ-14
@ObjectType()
export class LibraryTagMigrationTrack {
  @Field(() => String)
  source: string;

  @Field(() => String, { nullable: true })
  provider: string | null;

  @Field(() => Float, { nullable: true })
  syncScore: number | null;

  @Field(() => Float, { nullable: true })
  framerateRatio: number | null;

  @Field(() => Date, { nullable: true })
  embeddedAt: Date | null;
}

// Spec 123, REQ-14 REQ-15
@ObjectType()
export class LibraryTagMigrationItemDetails {
  @Field(() => Int)
  id: number;

  @Field(() => String, {
    description: 'Absolute container path of the library .mkv.',
  })
  filePath: string;

  @Field(() => Date, {
    nullable: true,
    description:
      'Database-derived children for the global group (REQ-14/15); every field nullable, null = omit.',
  })
  encodedAt: Date | null;

  @Field(() => String, { nullable: true })
  videoCodec: string | null;

  @Field(() => Int, { nullable: true })
  crf: number | null;

  @Field(() => Int, { nullable: true })
  preset: number | null;

  @Field(() => String, { nullable: true })
  contentKind: string | null;

  @Field(() => String, { nullable: true })
  resolutionCeiling: string | null;

  @Field(() => String, { nullable: true })
  outputResolution: string | null;

  @Field(() => Boolean, { nullable: true })
  grainApplied: boolean | null;

  @Field(() => Boolean, { nullable: true })
  deinterlaced: boolean | null;

  @Field(() => Float, { nullable: true })
  dubTrimSeconds: number | null;

  @Field(() => Float, { nullable: true })
  streamEndTrimSeconds: number | null;

  @Field(() => [LibraryTagMigrationTrack], {
    description: "Track children keyed by the track's existing PERCEPTOR_SOURCE value.",
  })
  tracks: LibraryTagMigrationTrack[];
}
