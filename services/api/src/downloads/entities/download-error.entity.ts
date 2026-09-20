import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class DownloadError {
  @Field()
  stage: string;

  @Field()
  key: string;

  @Field(() => String, { nullable: true })
  params?: string | null;

  @Field()
  message: string;
}
