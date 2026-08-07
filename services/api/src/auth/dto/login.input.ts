import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty } from 'class-validator';

@InputType()
export class LoginInput {
  @Field()
  @IsNotEmpty({ message: 'El usuario es requerido' })
  username: string;

  @Field()
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  password: string;
}