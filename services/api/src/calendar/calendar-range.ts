import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';

const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 62;

function parseDay(value: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw i18nError.badRequest(ERROR_KEYS.CALENDAR_INVALID_DATE, { value });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw i18nError.badRequest(ERROR_KEYS.CALENDAR_INVALID_DATE, { value });
  }
  return date;
}

export function parseCalendarRange(
  from: string,
  to: string,
): { from: Date; toExclusive: Date } {
  const start = parseDay(from);
  const end = parseDay(to);
  const spanDays = (end.getTime() - start.getTime()) / DAY_MS + 1;
  if (spanDays < 1 || spanDays > MAX_SPAN_DAYS) {
    throw i18nError.badRequest(ERROR_KEYS.CALENDAR_INVALID_RANGE);
  }
  return { from: start, toExclusive: new Date(end.getTime() + DAY_MS) };
}
