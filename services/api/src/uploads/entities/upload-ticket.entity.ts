import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class UploadTicket {
  @Field()
  token: string;

  @Field()
  expiresAt: Date;
}
