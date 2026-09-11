import { ObjectType, Field } from '@nestjs/graphql';

// One row per ISO-639-2/B code, carrying the native-script title the worker
// should burn into a track's display name (`051-language-track-titles`).
// Backed by `Language.trackTitle`, which is deliberately not exposed on
// `Language` itself — that entity's `name` is an English label for the
// picker, this is a separate, narrower catalog keyed by `iso3`.
@ObjectType()
export class LanguageTrackTitle {
  @Field()
  iso3: string;

  @Field()
  title: string;
}
