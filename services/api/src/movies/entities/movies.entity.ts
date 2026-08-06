import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

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
}