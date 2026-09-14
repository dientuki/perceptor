import { ObjectType, Field, Int } from '@nestjs/graphql';

// No `label`: service display names are user-facing copy and belong to
// web's message catalog, keyed off `id` — see ../plan.md § Contract
// obligations. MediaRoot's `label` field is pre-i18n legacy, not the
// pattern to follow here.
@ObjectType()
export class EnvironmentEndpoint {
  // String, not ID: the contract fixes this exactly (../spec.md § GraphQL
  // Contract Delta) — id is never sent back as an argument anywhere, so it
  // does not carry GraphQL's ID semantics the way MediaRoot.id does.
  @Field(() => String)
  id: string; // 'web' | 'api' | 'torrent' | 'indexer'

  // null when the port variable backing this endpoint is unset.
  @Field(() => Int, { nullable: true })
  port: number | null;

  // null when useTraefik is false, or domain is null — never a fabricated
  // host (NFR-1). See environment.service.ts.
  @Field(() => String, { nullable: true })
  url: string | null;
}

@ObjectType()
export class EnvironmentInfo {
  @Field()
  useTraefik: boolean;

  // Reported in both modes (REQ-3) — null only when the variable is unset
  // or empty, never filtered by useTraefik.
  @Field(() => String, { nullable: true })
  domain: string | null;

  // Always exactly four entries, ids web/api/torrent/indexer, in that order.
  @Field(() => [EnvironmentEndpoint])
  endpoints: EnvironmentEndpoint[];

  // What the upload endpoint should be, given useTraefik/domain — null under
  // the same condition as endpoints[].url.
  @Field(() => String, { nullable: true })
  expectedUploadEndpoint: string | null;
}
