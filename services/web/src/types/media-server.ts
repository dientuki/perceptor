// Espeja la query mediaServerClients del api — las opciones del combo salen
// del registro de clientes (api/src/clients/media-server/registry.ts), nunca
// de una lista hardcodeada acá.

export type MediaServerOption = {
  id: string; // 'none' | 'jellyfin' | ...
  label: string;
};
