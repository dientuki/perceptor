// Contrato del job entre la api (productor) y el worker (consumidor). El payload
// es un puntero, no una copia de datos: el worker resuelve el resto por GraphQL,
// así que una entrada vieja en la cola nunca puede cargar una ruta vieja.

export const PROCESS_QUEUE = 'process';
export const SOURCE_READY_JOB = 'source-ready';

export type SourceReadyJob = {
  mediaSourceId: number;
};
