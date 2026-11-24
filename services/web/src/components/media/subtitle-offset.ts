export const OFFSET_LIMIT = 600000;

export function parseOffset(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Math.abs(value) <= OFFSET_LIMIT ? value : null;
}
