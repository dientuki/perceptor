import { LibraryPossession } from './entities/library-possession.enum';

export const PAGE_SIZES = [12, 24, 48, 96] as const;
export const DEFAULT_PAGE_SIZE = 24;

export const LIBRARY_ORDER = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

export function clampPageSize(pageSize: number): number {
  return (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
}

export function totalPages(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

export function clampPage(page: number, pages: number): number {
  return Math.min(Math.max(1, page), pages);
}

export function possessionWhere(
  possession: LibraryPossession,
): { status?: 'COMPLETED' | { not: 'COMPLETED' } } {
  switch (possession) {
    case LibraryPossession.DOWNLOADED:
      return { status: 'COMPLETED' };
    case LibraryPossession.ADDED:
      return { status: { not: 'COMPLETED' } };
    default:
      return {};
  }
}
