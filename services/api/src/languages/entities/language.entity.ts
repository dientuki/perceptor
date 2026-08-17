import { ObjectType, Field, ID } from '@nestjs/graphql';

// The `languages` table is the only translation between ISO-639-1 (what the
// UI and the stored preferences use) and ISO-639-2/B (what `ffprobe` reports
// on `tags.language`, and what the worker needs) — see NFR-4 in
// 011-av1-transcode's spec. `name` is derived server-side from `iso2` via
// `language-names.ts`, never stored: it is Spanish display copy, not data.
@ObjectType()
export class Language {
  @Field(() => ID)
  id: number;

  @Field()
  iso2: string;

  @Field()
  iso3: string;

  @Field()
  name: string;
}
