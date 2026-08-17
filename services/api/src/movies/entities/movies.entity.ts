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

  @Field()
  status: string;

  @Field({ nullable: true })
  filePath?: string;

  @Field({ nullable: true })
  mediaSourceId?: number;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // Resolved by MoviesResolver's @ResolveField() — the calling user's own
  // per-title preference, never the merged set of every owner (that merge is
  // encode-time only, see process-jobs.service.ts). Never populated by
  // MoviesService itself.
  @Field(() => [Language])
  preferredLanguages: Language[];
}