import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

// Read-only, DB-first projection of one MediaSource plus, when it has an
// `infoHash`, the live fields DownloadsService joined in from a single
// qBittorrent `info(tag)` call. Never persisted — `readAt` is "the moment
// this row was assembled", not a database column (spec.md REQ-9/REQ-10:
// the browser never calls qBittorrent directly, and a value on screen is
// only ever as fresh as the last load or the last click).
//
// `infoHash` is nullable and is the controllability test, not `kind`: a
// `LOCAL_FILE` upload racing alongside torrents (REQ-18/REQ-19) has no
// infoHash and no live fields, and the panel must not offer it start, stop
// or delete. `kind` is carried for display only — `SourceKind` has two
// torrent values (`TORRENT_SEARCH`, `TORRENT_FILE`), so branching on it
// instead would be one wrong literal away from silently stripping the
// buttons off every row (see ../../../docs/spec/features/
// 022-download-status-tags/spec.md § GraphQL Contract Delta notes).
@ObjectType()
export class Download {
  @Field(() => Int)
  mediaSourceId: number;

  @Field({ nullable: true })
  infoHash?: string;

  @Field()
  kind: string;

  @Field()
  label: string;

  @Field({ nullable: true })
  releaseTitle?: string;

  @Field(() => Int, { nullable: true })
  movieId?: number;

  @Field(() => Int, { nullable: true })
  seasonId?: number;

  @Field(() => Int, { nullable: true })
  episodeId?: number;

  @Field()
  status: string;

  @Field({ nullable: true })
  torrentState?: string;

  @Field(() => Float, { nullable: true })
  downloadProgress?: number;

  @Field(() => Float, { nullable: true })
  encodeProgress?: number;

  @Field()
  compressionEnabled: boolean;

  @Field(() => Float, { nullable: true })
  downloadSpeed?: number;

  @Field(() => Float, { nullable: true })
  encodeSpeed?: number;

  @Field()
  readAt: Date;
}
