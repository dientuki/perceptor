// Espeja la query mediaRoots del api. Sin containerPath a propósito: la ruta
// de adentro del container es un detalle de implementación del stack, nunca
// algo que la UI muestre — ver services/api/src/media-roots/entities/media-root.entity.ts.

export type MediaRoot = {
  id: string; // 'downloads' | 'library'
  label: string;
  hostPath: string;
  available: boolean;
};
