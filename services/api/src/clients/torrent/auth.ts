// Spec 104, T005
export function torrentAuthHeaders(): Record<string, string> {
  const key = process.env.TORRENT_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}
