import { LibraryPossession } from './entities/library-possession.enum';
import {
  LIBRARY_ORDER,
  clampPage,
  clampPageSize,
  possessionWhere,
  totalPages,
} from './library-page';

// These helpers decide which titles a library page shows. A bug here does not
// throw: a wrong clamp shows an empty page for a non-empty library, a filter
// that mishandles a status hides titles from both tabs, and an order without a
// unique tiebreaker repeats or drops titles across page boundaries.
describe('library-page', () => {
  it('falls back to 24 for a page size outside the allowed set', () => {
    expect(clampPageSize(7)).toBe(24);
    expect(clampPageSize(48)).toBe(48);
  });

  it('clamps the page into 1..totalPages', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(99, 2)).toBe(2);
    expect(clampPage(2, 2)).toBe(2);
  });

  it('reports one page for an empty library', () => {
    expect(totalPages(0, 24)).toBe(1);
    expect(totalPages(25, 24)).toBe(2);
  });

  it('ADDED matches every status except COMPLETED', () => {
    const where = possessionWhere(LibraryPossession.ADDED);
    expect(where).toEqual({ status: { not: 'COMPLETED' } });
    const matches = (status: string) =>
      (where.status as { not: string }).not !== status;
    for (const s of ['ERROR', 'MISSING', 'DOWNLOADING']) expect(matches(s)).toBe(true);
    expect(matches('COMPLETED')).toBe(false);
  });

  it('DOWNLOADED is COMPLETED only and ALL is unfiltered', () => {
    expect(possessionWhere(LibraryPossession.DOWNLOADED)).toEqual({ status: 'COMPLETED' });
    expect(possessionWhere(LibraryPossession.ALL)).toEqual({});
  });

  it('orders by newest registration with id as the unique tiebreaker', () => {
    expect(LIBRARY_ORDER[0]).toEqual({ createdAt: 'desc' });
    expect(LIBRARY_ORDER[LIBRARY_ORDER.length - 1]).toEqual({ id: 'desc' });
  });
});
