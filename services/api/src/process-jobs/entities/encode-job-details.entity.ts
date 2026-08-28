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
  originalLanguage: string; // iso2, tal cual lo guarda Movie/Show (ej. 'en', 'ja')

  // iso3 del mismo idioma (ej. 'eng', 'jpn') — lo necesita el driver de ffmpeg para
  // elegir la pista de audio/subtítulo original (ver src/ffmpeg/params.ts en el worker,
  // que compara contra tags.language, que ffprobe reporta en iso3).
  @Field()
  originalLanguageIso3: string;

  // Every ISO-639-2/B code the encode is allowed to keep for audio/subtitles —
  // the original language plus the union of every owner's global and
  // per-title preference (REQ-3), deduplicated, original first. Never empty.
  // originalLanguageIso3 stays a separate field even though it duplicates the
  // first element here: the worker needs to know *which* of these is
  // mandatory (REQ-6), and inferring that from list position is a rule that
  // breaks the first time someone reorders the list.
  @Field(() => [String])
  allowedLanguagesIso3: string[];

  // The same merge as `allowedLanguagesIso3`, expressed in BCP-47 tags
  // instead of resolved ISO-639-2/B codes (030-language-regional-variants,
  // REQ-8). Not redundant with the field above: the iso3 list is what the
  // worker's ffmpeg rules match against `ffprobe`'s tags.language and is
  // lossy by design (`es-419`/`es-ES` both collapse to `spa`); this list is
  // what preserves which regional variant was actually asked for. Additive
  // and unread by the worker this cycle (NFR-4) — a follow-up spec teaches
  // it to act on this.
  @Field(() => [String])
  allowedLanguageTags: string[];

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

  // Ruta absoluta de container donde el worker tiene que armar la carpeta de
  // salida — resuelta server-side desde path_movies/path_shows (ver
  // ProcessJobsService, media-roots/). El worker sólo hace join()/mkdir()
  // sobre esto, nunca lee env para el destino.
  @Field()
  outputRoot: string;

  // The downloads ROOT itself, resolved with resolveFromRoot('downloads', '.') —
  // not the path_downloads setting. Torrents save under
  // <downloadsRoot>/<path_downloads>/<hash>, while tus uploads stage under
  // <downloadsRoot>/imports/<uploadId>; the worker's REQ-12 containment check
  // has to cover both, so it needs the root, not the narrower path_downloads
  // segment.
  @Field()
  downloadsRoot: string;

  // Resolved from `compression_enabled` at query time, not frozen onto the
  // ProcessJob row when it was enqueued (032-optional-compression, REQ-6).
  // False means: skip ffprobe/ffmpeg/mkvmerge and move the input file into
  // place instead.
  @Field()
  compressionEnabled: boolean;
}
