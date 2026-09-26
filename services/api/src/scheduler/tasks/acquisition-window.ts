export type WindowName = 'theatrical' | 'digital' | 'physical';

export interface AcquisitionMarks {
  theatrical: boolean;
  digital: boolean;
  physical: boolean;
  allowCinemaReleases: boolean;
}

export interface FilmDates {
  theatricalReleaseDate: Date | null;
  digitalReleaseDate: Date | null;
  physicalReleaseDate: Date | null;
}

export interface OpenWindow {
  openedAt: Date;
  minSourceRank: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const WINDOWS: Record<
  WindowName,
  { offsetDays: number; minSourceRank: number | null }
> = {
  theatrical: { offsetDays: 2, minSourceRank: null },
  digital: { offsetDays: 1, minSourceRank: 4 },
  physical: { offsetDays: 5, minSourceRank: 6 },
};

export const CHAINS: Record<WindowName, readonly WindowName[]> = {
  theatrical: ['theatrical', 'digital', 'physical'],
  digital: ['digital', 'physical'],
  physical: ['physical', 'digital'],
};

const DATE_FIELD: Record<WindowName, keyof FilmDates> = {
  theatrical: 'theatricalReleaseDate',
  digital: 'digitalReleaseDate',
  physical: 'physicalReleaseDate',
};

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function resolve(
  marked: WindowName,
  owner: AcquisitionMarks,
  dates: FilmDates,
): WindowName | null {
  for (const name of CHAINS[marked]) {
    if (name === 'theatrical' && !owner.allowCinemaReleases) continue;
    if (dates[DATE_FIELD[name]]) return name;
  }
  return null;
}

export function resolveOpenWindow(
  owners: readonly AcquisitionMarks[],
  dates: FilmDates,
  now: Date,
): OpenWindow | null {
  const resolved = new Set<WindowName>();
  for (const owner of owners) {
    for (const marked of Object.keys(WINDOWS) as WindowName[]) {
      if (!owner[marked]) continue;
      const name = resolve(marked, owner, dates);
      if (name) resolved.add(name);
    }
  }

  let openedAt: Date | null = null;
  let minSourceRank: number | null = null;
  let anyUnfloored = false;
  let floor: number | null = null;
  for (const name of resolved) {
    const date = dates[DATE_FIELD[name]] as Date;
    const opens = new Date(startOfUtcDay(date).getTime() + WINDOWS[name].offsetDays * DAY_MS);
    if (opens.getTime() > now.getTime()) continue;
    if (!openedAt || opens.getTime() < openedAt.getTime()) openedAt = opens;
    const rank = WINDOWS[name].minSourceRank;
    if (rank === null) anyUnfloored = true;
    else if (floor === null || rank < floor) floor = rank;
  }
  if (!openedAt) return null;
  minSourceRank = anyUnfloored ? null : floor;
  return { openedAt, minSourceRank };
}
