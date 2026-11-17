import { Prisma } from '@prisma/client';
import { isSnapshotWriteConflict } from './write-conflict';

// Spec 116, REQ-3 — this suite exists because the classifier decides which errors
// sourceScanned retries. Matching nothing leaves every 1020 failing in production with no
// sign the retry exists; matching too much retries real errors and logs them as conflicts.
describe('isSnapshotWriteConflict', () => {
  const known = (code: string, originalCode?: string) =>
    new Prisma.PrismaClientKnownRequestError('x', {
      code,
      clientVersion: 'test',
      meta: originalCode ? { driverAdapterError: { cause: { originalCode } } } : undefined,
    });

  it('is true for the MariaDB 1020 shape surfaced as P2039', () => {
    expect(isSnapshotWriteConflict(known('P2039', '1020'))).toBe(true);
  });

  it('is false for P2034, which other handlers own', () => {
    expect(isSnapshotWriteConflict(known('P2034'))).toBe(false);
  });

  it('is false for P2039 carrying another original code', () => {
    expect(isSnapshotWriteConflict(known('P2039', '1213'))).toBe(false);
  });

  it('is false for P2039 with no driver detail', () => {
    expect(isSnapshotWriteConflict(known('P2039'))).toBe(false);
  });

  it('is false for a plain Error and for null', () => {
    expect(isSnapshotWriteConflict(new Error('Record has changed since last read'))).toBe(false);
    expect(isSnapshotWriteConflict(null)).toBe(false);
  });
});
