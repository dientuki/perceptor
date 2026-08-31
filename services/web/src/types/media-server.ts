// Espeja la query mediaServerClients del api — las opciones del combo salen
// del registro de clientes (api/src/clients/media-server/registry.ts), nunca
// de una lista hardcodeada acá.

export type MediaServerOption = {
  id: string; // 'none' | 'jellyfin' | ...
  label: string;
};

// `state` is deliberately `string`, not a union of the four literals api
// currently sends ("never" | "syncing" | "ready" | "failed") — there is no
// codegen across this boundary, so narrowing here means a fifth state added
// later on the api side fails to compile against a value it legitimately
// sends, rather than just rendering as an unrecognized status.
export type MediaServerIndexStatus = {
  state: string;
  itemCount: number;
  syncedAt: string | null;
};
