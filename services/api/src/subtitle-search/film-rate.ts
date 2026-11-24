// Spec 121, REQ-18
const FILM_RATE = 24 / 23.976;

// Spec 121, REQ-18
export const FILM_RATE_RATIOS: readonly number[] = [FILM_RATE, 23.976 / 24];

const REPORT_TOLERANCE = 0.0005;

const TIME = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/;

// Spec 121, REQ-18
export function filmRateRatio(reported: number): number | null {
  for (const ratio of FILM_RATE_RATIOS) {
    if (Math.abs(reported - ratio) <= REPORT_TOLERANCE) return ratio;
  }
  return null;
}

function scaleTime(token: string, ratio: number): string | null {
  const m = TIME.exec(token);
  if (!m) return null;
  const ms =
    Number(m[1]) * 3_600_000 +
    Number(m[2]) * 60_000 +
    Number(m[3]) * 1000 +
    Number(m[4].padEnd(3, '0'));
  const scaled = Math.round(ms * ratio);
  const h = Math.floor(scaled / 3_600_000);
  const min = Math.floor((scaled % 3_600_000) / 60_000);
  const s = Math.floor((scaled % 60_000) / 1000);
  const milli = scaled % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(min, 2)}:${pad(s, 2)},${pad(milli, 3)}`;
}

// Spec 121, REQ-18
export function rescaleSrt(text: string, ratio: number): string | null {
  const parts = text.split(/(\r\n|\n|\r)/);
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    if (!line.includes('-->')) continue;
    const sides = line.split('-->');
    if (sides.length !== 2) return null;
    const out: string[] = [];
    for (const side of sides) {
      const lead = /^\s*/.exec(side)?.[0] ?? '';
      const trail = /\s*$/.exec(side)?.[0] ?? '';
      const scaled = scaleTime(side.trim(), ratio);
      if (scaled === null) return null;
      out.push(`${lead}${scaled}${trail}`);
    }
    parts[i] = out.join('-->');
  }
  return parts.join('');
}
