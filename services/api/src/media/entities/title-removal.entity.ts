import { ObjectType, Field, Int } from '@nestjs/graphql';

// The outcome of removing a title from the caller's library (067).
@ObjectType({ description: "The outcome of removing a title from the caller's library." })
export class TitleRemoval {
  @Field({ description: 'True when the caller was the last owner and the title itself was deleted from Perceptor.' })
  deleted: boolean;

  @Field(() => Int, {
    description: 'How many users still own the title after this removal. 0 when `deleted` is true.',
  })
  remainingOwners: number;
}
