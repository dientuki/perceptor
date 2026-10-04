import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { Language } from '@/languages/entities/language.entity';
import { ContentKind } from '@/media/entities/content-kind.enum';

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

  @Field(() => ContentKind)
  contentKind: ContentKind;

  // Spec 048, REQ-1
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

  // Spec 039, REQ-9; Spec 039, REQ-11
  @Field()
  audioMandatory: boolean;

  // How many *other* users have this film in their library (067). Populated
  // by the resolver only when selected; never by MoviesService's listings.
  @Field(() => Int, { description: 'How many *other* users have this film in their library. 0 when the caller is the last owner.' })
  otherOwners: number;
}