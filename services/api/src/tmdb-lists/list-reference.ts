const BARE_ID = /^\d+$/;
const LIST_PATH = /\/list\/(\d+)(?:-[^/]*)?\/?$/;

function positive(digits: string): number | null {
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function parseListReference(input: string): number | null {
  const text = input.trim();
  if (BARE_ID.test(text)) return positive(text);

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'themoviedb.org' && !host.endsWith('.themoviedb.org'))
    return null;

  const match = LIST_PATH.exec(url.pathname);
  return match ? positive(match[1]) : null;
}
