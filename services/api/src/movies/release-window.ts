const CLOSED_AFTER_DAYS = 365;
const CANCELED_STATUS = 'Canceled';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReleaseWindowInput = {
  earliestReleaseDate: string | null;
  theatricalReleaseDate: string | null;
  digitalReleaseDate: string | null;
  physicalReleaseDate: string | null;
  status: string | null;
  now: Date;
};

function utcDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY,
  );
}

function parseDayNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const time = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(time) ? null : Math.floor(time / MS_PER_DAY);
}

export function isReleaseWindowClosed({
  earliestReleaseDate,
  theatricalReleaseDate,
  digitalReleaseDate,
  physicalReleaseDate,
  status,
  now,
}: ReleaseWindowInput): boolean {
  if (status === CANCELED_STATUS) {
    return true;
  }

  const days = [earliestReleaseDate, theatricalReleaseDate, digitalReleaseDate, physicalReleaseDate]
    .map(parseDayNumber)
    .filter((day): day is number => day !== null);

  if (days.length === 0) {
    return false;
  }

  const today = utcDayNumber(now);
  const newest = Math.max(...days);

  return newest <= today && today - newest > CLOSED_AFTER_DAYS;
}
