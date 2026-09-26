/**
 * `isReleaseWindowClosed` decides when a film stops being refreshed by the sweep. A wrong rule here
 * (an off-by-one on the 365-day boundary, a future date counted as old, a null date read as "very
 * old", the oldest date winning over the newest) raises no exception, writes no log and shows nothing
 * in the UI: the film simply stops being refreshed forever, or is refreshed forever. These cases
 * exist because otherwise a mis-closed film fails with no error anywhere.
 */
import { isReleaseWindowClosed, ReleaseWindowInput } from './release-window';

const NOW = new Date('2026-09-26T15:30:00Z');

// 2026-09-26 minus 365 UTC days (no 29 February in between) and minus 366.
const EXACTLY_365_DAYS_AGO = '2025-09-26';
const EXACTLY_366_DAYS_AGO = '2025-09-25';

function input(overrides: Partial<ReleaseWindowInput>): ReleaseWindowInput {
  return {
    earliestReleaseDate: null,
    theatricalReleaseDate: null,
    digitalReleaseDate: null,
    physicalReleaseDate: null,
    status: null,
    now: NOW,
    ...overrides,
  };
}

describe('isReleaseWindowClosed', () => {
  it('keeps a film open when its newest date is exactly 365 UTC days old', () => {
    expect(isReleaseWindowClosed(input({ theatricalReleaseDate: EXACTLY_365_DAYS_AGO }))).toBe(false);
  });

  it('closes a film when its newest date is 366 UTC days old', () => {
    expect(isReleaseWindowClosed(input({ theatricalReleaseDate: EXACTLY_366_DAYS_AGO }))).toBe(true);
  });

  it('counts whole UTC days, not elapsed hours, at the boundary', () => {
    const lateInTheDay = new Date('2026-09-26T23:59:59Z');
    expect(
      isReleaseWindowClosed(input({ theatricalReleaseDate: EXACTLY_365_DAYS_AGO, now: lateInTheDay })),
    ).toBe(false);
  });

  it('keeps a film open when a future date sits beside old ones', () => {
    expect(
      isReleaseWindowClosed(
        input({
          earliestReleaseDate: '2020-01-01',
          theatricalReleaseDate: '2020-02-01',
          digitalReleaseDate: '2026-12-01',
        }),
      ),
    ).toBe(false);
  });

  it('keeps a film open when its only date is in the future', () => {
    expect(isReleaseWindowClosed(input({ earliestReleaseDate: '2027-01-01' }))).toBe(false);
  });

  it('closes a Canceled film even when it has a future date', () => {
    expect(
      isReleaseWindowClosed(input({ status: 'Canceled', digitalReleaseDate: '2027-01-01' })),
    ).toBe(true);
  });

  it('closes a Canceled film with no dates at all', () => {
    expect(isReleaseWindowClosed(input({ status: 'Canceled' }))).toBe(true);
  });

  it('never closes a film by age when every date is null and it is not Canceled', () => {
    expect(isReleaseWindowClosed(input({ status: 'Released' }))).toBe(false);
    expect(isReleaseWindowClosed(input({ status: null }))).toBe(false);
  });

  it('lets the newest of the four dates decide, not the oldest', () => {
    expect(
      isReleaseWindowClosed(
        input({
          earliestReleaseDate: '2015-01-01',
          theatricalReleaseDate: '2015-06-01',
          digitalReleaseDate: '2026-06-01', // recent: keeps it open
          physicalReleaseDate: '2016-01-01',
        }),
      ),
    ).toBe(false);
  });

  it('closes a film only when all four dates are past the window', () => {
    expect(
      isReleaseWindowClosed(
        input({
          earliestReleaseDate: '2015-01-01',
          theatricalReleaseDate: '2015-06-01',
          digitalReleaseDate: EXACTLY_366_DAYS_AGO,
          physicalReleaseDate: '2016-01-01',
        }),
      ),
    ).toBe(true);
  });
});
