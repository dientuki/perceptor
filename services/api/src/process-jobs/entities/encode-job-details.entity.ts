import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

// Todo lo que el worker necesita para encodear un ProcessJob en un solo round
// trip: input físico + los datos de la media (película o episodio, aplanados
// en vez de exponer el grafo entero) + lo necesario para limpiar el torrent al
// terminar. "kind" reemplaza al enum MediaType del repo viejo (no existe acá):
// alcanza con mirar cuál de movieId/episodeId no es null.
@ObjectType()
export class EncodeJobDetails {
  @Field(() => ID)
  id: number;

  @Field()
  status: string;

  @Field()
  inputFilePath: string;

  @Field()
  kind: string; // 'MOVIE' | 'EPISODE'

  // De la Movie o del Show (según kind) — lo necesita el cliente de Jellyfin
  // para el matching por [tmdbid=...] en vez de confiar en el nombre.
  @Field(() => Int)
  tmdbId: number;

  @Field()
  title: string;

  @Field(() => Int, { nullable: true })
  year: number | null;

  @Field()
  originalLanguage: string;

  @Field()
  isLiveAction: boolean;

  @Field(() => Int, { nullable: true })
  seasonNumber: number | null;

  @Field(() => Int, { nullable: true })
  episodeNumber: number | null;

  @Field(() => String, { nullable: true })
  episodeTitle: string | null;

  @Field(() => Int)
  mediaSourceId: number;

  @Field()
  sourceKind: string;

  @Field(() => String, { nullable: true })
  infoHash: string | null;

  @Field(() => String, { nullable: true })
  downloadPath: string | null;
}
