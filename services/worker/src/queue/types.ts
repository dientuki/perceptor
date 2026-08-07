// Copia a propósito de services/api/src/queue/types.ts (fuente de verdad). El
// build context del worker es ./services/worker, así que la imagen no puede ver
// ../api: un import compartido es físicamente imposible sin reestructurar a
// workspaces. No "arreglar" esto inventando un paquete.

export const PROCESS_QUEUE = 'process';
export const SOURCE_READY_JOB = 'source-ready';

export type SourceReadyJob = {
  mediaSourceId: number;
};
