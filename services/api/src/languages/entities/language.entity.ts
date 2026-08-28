import { ObjectType, Field, ID } from '@nestjs/graphql';

// The `languages` table is the only translation between ISO-639-1 (what
// TMDB's `originalLanguage` uses) and ISO-639-2/B (what `ffprobe` reports
// on `tags.language`, and what the worker needs) — see NFR-4 in
// 011-av1-transcode's spec. Since 030-language-regional-variants, `tag`
// (BCP-47) is the identifier every stored preference and every GraphQL
// argument uses; `iso2` stays on the row for TMDB's original-language join
// and as the group key `web` renders under, but is no longer unique — three
// rows (`es`, `es-419`, `es-ES`) can share it. `name` is derived
// server-side from `tag` via `language-names.ts`, never stored.
@ObjectType()
export class Language {
  @Field(() => ID)
  id: number;

  @Field()
  tag: string;

  @Field()
  iso2: string;

  @Field()
  iso3: string;

  @Field()
  name: string;
}
