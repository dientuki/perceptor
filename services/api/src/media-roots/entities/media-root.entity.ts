import { ObjectType, Field, ID } from '@nestjs/graphql';

// Sin containerPath: la ruta de adentro del container es un detalle de
// implementación del stack, nunca algo que el usuario deba ver ni entender.
// La UI sólo conoce la raíz del lado del host (para mostrar el prefijo) y el
// segmento relativo que el usuario tipea — ver settings/settings.catalog.ts.
@ObjectType()
export class MediaRoot {
  @Field(() => ID)
  id: string; // 'downloads' | 'library'

  @Field()
  label: string;

  @Field()
  hostPath: string;

  // false si el mount no está montado (falta CONTAINER_*_DIR en el host, o el
  // volumen no se creó) — la UI lo muestra como advertencia en vez de que la
  // primera señal sea un ENOENT al guardar un setting.
  @Field()
  available: boolean;
}
