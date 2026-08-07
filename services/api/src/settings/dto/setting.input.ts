import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty } from 'class-validator';

@InputType()
export class SettingInput {
  @Field()
  @IsNotEmpty({ message: 'La clave es requerida' })
  key: string;

  @Field()
  @IsNotEmpty({ message: 'El valor es requerido' })
  value: string;
}
