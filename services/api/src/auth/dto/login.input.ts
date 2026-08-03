import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty } from 'class-validator';

@InputType()
export class LoginInput {
  @Field()
  @IsEmail({}, { message: 'El email no es válido' })
  email: string;

  @Field()
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  password: string;
}