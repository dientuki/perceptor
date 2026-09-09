import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { Language } from '@/languages/entities/language.entity';

@ObjectType()
export class Movie {
  @Field(() => ID)
  id: number;

  @Field(() => Int)
  tmdbId: number;

  @Field()
  title: string;

  @Field({ nullable: true })
  overview?: string;

  @Field({ nullable: true })
  posterUrl?: string;

  @Field({ nullable: true })
  releaseDate?: Date;

  @Field()
  originalLanguage: string;

  @Field()
  isLiveAction: boolean;

  // 048-shorts-category REQ-1: a property of the film, shared by every user
  // who has it in their library — straight off the Prisma row, no
  // @ResolveField (api/plan.md step 11).
  @Field()
  isShort: boolean;

  @Field()
  status: string;

  @Field({ nullable: true })
  filePath?: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // Resolved by MoviesResolver's @ResolveField() — the calling user's own
  // per-title preference, split by kind (039-per-title-language-split),
  // never the merged set of every owner (that merge is encode-time only,
  // see process-jobs.service.ts). Never populated by MoviesService itself.
  @Field(() => [Language])
  audioLanguages: Language[];

  @Field(() => [Language])
  subtitleLanguages: Language[];

  // The calling user's own audio-mandatory flag for this film, read off the
  // ownership row (039-per-title-language-split REQ-9). Inert this cycle —
  // nothing consumes it yet (REQ-11). Never populated by MoviesService itself.
  @Field()
  audioMandatory: boolean;
}