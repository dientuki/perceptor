import { ObjectType, Field, Int } from '@nestjs/graphql';

// Resultado de búsqueda en TMDB (no confundir con la entidad Movie, que es
// lo que ya está registrado en nuestra DB). El campo `id` es el id de TMDB.
@ObjectType()
export class MediaSearchResult {
  @Field(() => Int)
  id: number;

  @Field()
  title: string;

  @Field(() => String, { nullable: true })
  releaseDate?: string | null;

  @Field(() => String, { nullable: true })
  posterUrl?: string | null;

  @Field()
  originalLanguage: string;

  @Field({ nullable: true })
  overview?: string;

  // "movie" | "show" — string plano (no enum) para no romper la comparación
  // por valor que ya hace la UI de web (item.type === MEDIA_TYPE.SHOW).
  @Field()
  type: string;

  @Field({ nullable: true })
  status?: string;

  // Id of the Movie row when this film is already registered by anyone;
  // null when it is not (see cacheKey ordering note in movies.service.ts —
  // this field is deliberately absent from clients/types.ts's
  // MediaSearchResult, which is the shared Redis-cached shape).
  @Field(() => Int, { nullable: true })
  movieId?: number | null;

  // True only when the calling user already has this film in their own
  // library. Never cached — computed per-request after the catalog result
  // is already in Redis.
  @Field()
  inLibrary: boolean;
}
