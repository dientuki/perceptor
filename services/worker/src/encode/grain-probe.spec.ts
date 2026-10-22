// Article IX: the probe's arithmetic and filter are silent-failure territory.
// A unit slip (bits vs bytes, window seconds) or a job-ceiling leaking into the
// scale box makes every title pass or fail with no error anywhere.
import { describe, expect, it } from 'vitest';
import {
  GRAIN_PROBE_SAVED_MBPS_THRESHOLD,
  buildProbeVideoFilter,
  buildWindowEncodeArgs,
  computeGrainSaving,
  cropTimestamps,
  majorityCrop,
  windowTimestamps,
} from './grain-probe';

describe('computeGrainSaving', () => {
  it('reproduces the Lionheart corpus row', () => {
    const sum0 = 76_198_923;
    const sumGrain = Math.round(sum0 * (1 - 0.2455));
    const windows = Array.from({ length: 9 }, (_, i) => ({
      bytes0: Math.floor(sum0 / 9) + (i === 0 ? sum0 % 9 : 0),
      bytesGrain: Math.floor(sumGrain / 9) + (i === 0 ? sumGrain % 9 : 0),
    }));
    const r = computeGrainSaving(windows);
    expect(r.mbpsGrain0).toBeCloseTo(11.289, 3);
    expect(r.savingPct).toBeCloseTo(24.55, 2);
    expect(r.savedMbps).toBeCloseTo(2.771, 3);
    expect(r.passed).toBe(true);
  });

  it('excludes a window under 1000 bytes from both sums', () => {
    const good = { bytes0: 1_000_000, bytesGrain: 800_000 };
    const r = computeGrainSaving([good, { bytes0: 500, bytesGrain: 900_000 }, { bytes0: 900_000, bytesGrain: 999 }]);
    expect(r.savingPct).toBeCloseTo(20, 6);
    expect(r.mbpsGrain0).toBeCloseTo((1_000_000 * 8) / 6 / 1e6, 6);
  });

  it('throws when no window counts', () => {
    expect(() => computeGrainSaving([{ bytes0: 0, bytesGrain: 0 }])).toThrow();
    expect(() => computeGrainSaving([])).toThrow();
  });

  it('fails the threshold just below it', () => {
    const r = computeGrainSaving([{ bytes0: 6_000_000, bytesGrain: 6_000_000 }]);
    expect(r.savedMbps).toBe(0);
    expect(r.passed).toBe(false);
    expect(GRAIN_PROBE_SAVED_MBPS_THRESHOLD).toBe(0.886);
  });
});

describe('timestamps', () => {
  it('places crop samples at 10%..80% of a 1000 s duration', () => {
    expect(cropTimestamps(1000).map((t) => Math.round(t))).toEqual([100, 275, 450, 625, 800]);
  });

  it('places nine windows evenly inside 5%..95%', () => {
    const t = windowTimestamps(900);
    expect(t).toHaveLength(9);
    expect(t[0]).toBeCloseTo(45 + 405 * (0.5 / 9) * 2, 6);
    expect(t[4]).toBeCloseTo(450, 6);
    expect(t[8]).toBeCloseTo(45 + 810 * (8.5 / 9), 6);
  });
});

describe('majorityCrop', () => {
  it('picks the majority over one outlier', () => {
    expect(majorityCrop(['crop=1920:800:0:140', 'crop=1920:1080:0:0', 'crop=1920:800:0:140'])).toBe('crop=1920:800:0:140');
  });

  it('returns null with no samples', () => {
    expect(majorityCrop([])).toBeNull();
  });
});

describe('buildProbeVideoFilter', () => {
  it('scales a 4K source into the 1080p box regardless of any job ceiling', () => {
    const filter = buildProbeVideoFilter(null, 3840, 2160);
    expect(filter).toBe('scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2');
    expect(buildProbeVideoFilter.length).toBe(3);
  });

  it('yields the same filter for the same source whatever the job resolution', () => {
    const a = buildProbeVideoFilter('crop=3840:1600:0:280', 3840, 2160);
    const b = buildProbeVideoFilter('crop=3840:1600:0:280', 3840, 2160);
    expect(a).toBe(b);
    expect(a).toContain('crop=3840:1600:0:280,scale=1920:1080');
  });

  it('is absent for a source already inside the box', () => {
    expect(buildProbeVideoFilter(null, 1920, 1080)).toBeNull();
    expect(buildProbeVideoFilter(null, 1280, 720)).toBeNull();
  });

  it('measures the cropped size against the box', () => {
    expect(buildProbeVideoFilter('crop=1920:800:0:140', 1920, 1080)).toBe('crop=1920:800:0:140');
  });
});

describe('buildWindowEncodeArgs', () => {
  it('writes to stdout as matroska and never to disk', () => {
    const args = buildWindowEncodeArgs('/in.mkv', 12.345, null, 'film-grain=0');
    expect(args.slice(-3)).toEqual(['-f', 'matroska', 'pipe:1']);
    expect(args).toContain('22');
    expect(args).toContain('8');
    expect(args).not.toContain('-vf');
  });
});
