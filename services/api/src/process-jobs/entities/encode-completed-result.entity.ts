import { ObjectType, Field } from '@nestjs/graphql';

// The three cleanup instructions `encodeCompleted` hands back to the worker,
// computed server-side from the sibling ProcessJob rows and hasUnmatchedFiles
// (Constitution, Article III — the worker cannot see either). Each is an
// independent physical action, not a status; the worker executes whichever
// are true in the order they're declared here. See spec.md's verdict table
// (013-season-pack-processing) for the exact rules behind each field.
@ObjectType()
export class EncodeCompletedResult {
  @Field()
  message: string;

  @Field()
  removeTorrent: boolean;

  @Field()
  deleteInputFile: boolean;

  @Field()
  deleteDownloadPath: boolean;
}
