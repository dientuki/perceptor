/**
 * Automatic film acquisition decides when to start looking, and at what quality floor, purely from
 * three dates and the owners' marks. If an offset, a fallback chain or a floor is wrong nothing
 * fails: the sweep just never acquires a film, or takes a CAM or a WEBRip the user did not ask for,
 * with no error anywhere. These cases pin the 2/1/5 day offsets in UTC, the three chains (none of
 * which may reach theatrical), the theatrical suppression, and the lowest-floor rule, where a
 * window with no floor is null and never 0.
 */
import { AcquisitionMarks, FilmDates, resolveOpenWindow } from './acquisition-window';

const D = (iso: string) => new Date(iso);
const none: FilmDates = {
  theatricalReleaseDate: null,
  digitalReleaseDate: null,
  physicalReleaseDate: null,
};
const marks = (m: Partial<AcquisitionMarks>): AcquisitionMarks => ({
  theatrical: false,
  digital: false,
  physical: false,
  allowCinemaReleases: false,
  ...m,
});

describe('resolveOpenWindow', () => {
  const cases: Array<[string, Partial<AcquisitionMarks>, keyof FilmDates, number, number | null]> = [
    ['theatrical', { theatrical: true, allowCinemaReleases: true }, 'theatricalReleaseDate', 2, null],
    ['digital', { digital: true }, 'digitalReleaseDate', 1, 4],
    ['physical', { physical: true }, 'physicalReleaseDate', 5, 6],
  ];

  describe.each(cases)('%s window', (_n, m, field, offset, floor) => {
    const dates = { ...none, [field]: D('2026-03-10T15:30:00Z') };
    const opens = D(`2026-03-${10 + offset}T00:00:00Z`);

    it('is closed the last millisecond before it opens', () => {
      const now = new Date(opens.getTime() - 1);
      expect(resolveOpenWindow([marks(m)], dates, now)).toBeNull();
    });

    it('opens exactly at UTC midnight of the opening day', () => {
      expect(resolveOpenWindow([marks(m)], dates, opens)).toEqual({
        openedAt: opens,
        minSourceRank: floor,
      });
    });

    it('stays open the day after', () => {
      const now = new Date(opens.getTime() + 24 * 3600 * 1000);
      expect(resolveOpenWindow([marks(m)], dates, now)?.openedAt).toEqual(opens);
    });
  });

  it('returns null, not 0, for a window with no floor', () => {
    const r = resolveOpenWindow(
      [marks({ theatrical: true, allowCinemaReleases: true })],
      { ...none, theatricalReleaseDate: D('2026-03-10T00:00:00Z') },
      D('2026-03-20T00:00:00Z'),
    );
    expect(r?.minSourceRank).toBeNull();
  });

  describe('fallback chains', () => {
    const now = D('2027-01-01T00:00:00Z');
    const d = D('2026-03-10T00:00:00Z');

    it('digital marked falls to physical', () => {
      const r = resolveOpenWindow([marks({ digital: true })], { ...none, physicalReleaseDate: d }, now);
      expect(r).toEqual({ openedAt: D('2026-03-15T00:00:00Z'), minSourceRank: 6 });
    });

    it('physical marked falls to digital with digital offset and floor (AC-6)', () => {
      const r = resolveOpenWindow([marks({ physical: true })], { ...none, digitalReleaseDate: d }, now);
      expect(r).toEqual({ openedAt: D('2026-03-11T00:00:00Z'), minSourceRank: 4 });
    });

    it('theatrical marked walks through digital then physical', () => {
      const m = marks({ theatrical: true, allowCinemaReleases: true });
      expect(resolveOpenWindow([m], { ...none, digitalReleaseDate: d }, now)?.minSourceRank).toBe(4);
      expect(resolveOpenWindow([m], { ...none, physicalReleaseDate: d }, now)?.minSourceRank).toBe(6);
    });

    it.each([['digital'], ['physical']] as const)(
      'no chain reaches theatrical: %s marked with only a theatrical date is not open (AC-7)',
      (name) => {
        const m = marks({ [name]: true, allowCinemaReleases: true });
        expect(resolveOpenWindow([m], { ...none, theatricalReleaseDate: d }, now)).toBeNull();
      },
    );
  });

  describe('allowCinemaReleases off', () => {
    const now = D('2027-01-01T00:00:00Z');
    const d = D('2026-03-10T00:00:00Z');

    it('suppresses theatrical when it is the only date (AC-8)', () => {
      const r = resolveOpenWindow([marks({ theatrical: true })], { ...none, theatricalReleaseDate: d }, now);
      expect(r).toBeNull();
    });

    it('resolves onward to digital', () => {
      const r = resolveOpenWindow(
        [marks({ theatrical: true })],
        { ...none, theatricalReleaseDate: d, digitalReleaseDate: d },
        now,
      );
      expect(r).toEqual({ openedAt: D('2026-03-11T00:00:00Z'), minSourceRank: 4 });
    });
  });

  describe('lowest floor across open windows', () => {
    const dates: FilmDates = {
      theatricalReleaseDate: D('2026-03-01T00:00:00Z'),
      digitalReleaseDate: D('2026-03-05T00:00:00Z'),
      physicalReleaseDate: D('2026-03-10T00:00:00Z'),
    };

    it('two open: digital and physical give 4 and the earliest openedAt', () => {
      const r = resolveOpenWindow([marks({ digital: true, physical: true })], dates, D('2026-04-01T00:00:00Z'));
      expect(r).toEqual({ openedAt: D('2026-03-06T00:00:00Z'), minSourceRank: 4 });
    });

    it('three open: theatrical drops the floor to null', () => {
      const m = marks({ theatrical: true, digital: true, physical: true, allowCinemaReleases: true });
      const r = resolveOpenWindow([m], dates, D('2026-04-01T00:00:00Z'));
      expect(r).toEqual({ openedAt: D('2026-03-03T00:00:00Z'), minSourceRank: null });
    });

    it('a window not yet open does not lower the floor', () => {
      const r = resolveOpenWindow(
        [marks({ digital: true, physical: true })],
        dates,
        D('2026-03-08T00:00:00Z'),
      );
      expect(r).toEqual({ openedAt: D('2026-03-06T00:00:00Z'), minSourceRank: 4 });
      const r2 = resolveOpenWindow([marks({ physical: true })], dates, D('2026-03-14T00:00:00Z'));
      expect(r2).toBeNull();
    });

    it('unions the marks of several owners', () => {
      const r = resolveOpenWindow(
        [marks({ physical: true }), marks({ digital: true })],
        dates,
        D('2026-04-01T00:00:00Z'),
      );
      expect(r?.minSourceRank).toBe(4);
    });
  });

  it('is not open when all dates are null (AC-9)', () => {
    const m = marks({ theatrical: true, digital: true, physical: true, allowCinemaReleases: true });
    expect(resolveOpenWindow([m], none, D('2030-01-01T00:00:00Z'))).toBeNull();
  });

  it('is not open when nothing is marked', () => {
    expect(
      resolveOpenWindow([marks({})], { ...none, digitalReleaseDate: D('2026-01-01T00:00:00Z') }, D('2030-01-01T00:00:00Z')),
    ).toBeNull();
  });
});
