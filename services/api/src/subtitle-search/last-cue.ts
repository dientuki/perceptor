const TIMING =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;

// Spec 103, REQ-10
export function lastCueEndMs(srt: string): number | null {
  let last: number | null = null;
  for (const m of srt.matchAll(TIMING)) {
    const end =
      Number(m[5]) * 3_600_000 +
      Number(m[6]) * 60_000 +
      Number(m[7]) * 1000 +
      Number(m[8].padEnd(3, '0'));
    if (last === null || end > last) last = end;
  }
  return last;
}
