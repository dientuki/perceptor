// Copia a propósito de services/api/src/queue/types.ts (fuente de verdad). El
// build context del worker es ./services/worker, así que la imagen no puede ver
// ../api: un import compartido es físicamente imposible sin reestructurar a
// workspaces. No "arreglar" esto inventando un paquete.
// This also covers the cancellation channel below: source of truth is
// services/api/src/queue/types.ts, hand-copied here — nothing enforces the
// two stay in sync.

export const PROCESS_QUEUE = 'process';
export const SOURCE_READY_JOB = 'source-ready';

export type SourceReadyJob = {
  mediaSourceId: number;
};

export const ENCODE_QUEUE = 'encode';
export const ENCODE_JOB = 'encode';

export type EncodeJob = {
  processJobId: number;
};

// Redis pub/sub channel, not a queue — a cancellation is only meaningful to a worker
// running the job right now and must never be persisted for one to pick up later.
export const ENCODE_CANCEL_CHANNEL = 'encode:cancel';

export type EncodeCancelMessage = {
  processJobId: number;
};
