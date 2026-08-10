import { InputType, Field } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty } from 'class-validator';

@InputType()
export class LoginInput {
  @Field()
  @IsNotEmpty({ message: 'El usuario es requerido' })
  username: string;

  @Field()
  @IsNotEmpty({ message: 'La contraseña es requerida' })
  password: string;

  // defaultValue (not nullable: true) is what makes this render as
  // `Boolean = false` in the generated SDL instead of bare `Boolean` — the
  // frozen contract requires the former character for character.
  @Field(() => Boolean, { defaultValue: false })
  @IsBoolean()
  rememberMe: boolean;
}