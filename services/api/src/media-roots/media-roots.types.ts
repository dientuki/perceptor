// Forma interna de una raíz — a diferencia de la entidad GraphQL (MediaRoot),
// esta sí lleva containerPath: media-roots.service.ts la necesita para
// resolver/validar, pero nunca cruza el borde de la API hacia afuera.
export type MediaRootConfig = {
  id: string;
  label: string;
  hostPath: string;
  containerPath: string;
};

// Token de inyección: las raíces se arman desde env en media-roots.module.ts,
// no leyendo process.env adentro del servicio — así el spec puede inyectar
// raíces apuntando a un mkdtemp y probar escapes/symlinks contra un
// filesystem real sin tocar el del container.
export const MEDIA_ROOTS = 'MEDIA_ROOTS';
