import { Prisma } from '@prisma/client';

// Spec 116, REQ-3
export function isSnapshotWriteConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code !== 'P2039') {
    return false;
  }
  const meta = error.meta as
    | { driverAdapterError?: { cause?: { originalCode?: unknown } } }
    | undefined;
  return String(meta?.driverAdapterError?.cause?.originalCode) === '1020';
}
