/**
 * Defends against a release on the first or last visible day silently
 * disappearing (an off-by-one on the range edges), and against dates like
 * 2026-02-30 silently rolling into March instead of being refused.
 */
import { BadRequestException } from '@nestjs/common';
import { parseCalendarRange } from './calendar-range';

function failure(fn: () => unknown): BadRequestException {
  try {
    fn();
  } catch (e) {
    return e as BadRequestException;
  }
  throw new Error('expected parseCalendarRange to throw');
}

describe('parseCalendarRange', () => {
  it('accepts a same-day range and makes it one day wide', () => {
    const r = parseCalendarRange('2026-09-19', '2026-09-19');
    expect(r.from.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    expect(r.toExclusive.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('puts toExclusive exactly one day past to, across a month boundary', () => {
    const r = parseCalendarRange('2026-08-30', '2026-08-31');
    expect(r.toExclusive.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('accepts an inclusive span of 62 days', () => {
    expect(() => parseCalendarRange('2026-08-01', '2026-10-01')).not.toThrow();
  });

  it('refuses an inclusive span of 63 days', () => {
    const e = failure(() => parseCalendarRange('2026-08-01', '2026-10-02'));
    expect(JSON.stringify(e.getResponse())).toContain('invalid_range');
  });

  it('refuses a reversed range', () => {
    const e = failure(() => parseCalendarRange('2026-09-19', '2026-09-18'));
    expect(JSON.stringify(e.getResponse())).toContain('invalid_range');
  });

  it.each(['2026-02-30', '2026-13-01'])('refuses %s naming it', (bad) => {
    const asFrom = failure(() => parseCalendarRange(bad, '2026-12-01'));
    expect(JSON.stringify(asFrom.getResponse())).toContain('invalid_date');
    expect(JSON.stringify(asFrom.getResponse())).toContain(bad);
    const asTo = failure(() => parseCalendarRange('2026-01-01', bad));
    expect(JSON.stringify(asTo.getResponse())).toContain(bad);
  });

  it('refuses a value that is not YYYY-MM-DD', () => {
    const e = failure(() => parseCalendarRange('2026-9-1', '2026-09-02'));
    expect(JSON.stringify(e.getResponse())).toContain('invalid_date');
  });
});
