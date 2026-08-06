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
}
