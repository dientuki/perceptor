import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';

// Some indexers (LimeTorrents is the one that surfaced this) never populate `infoHash` or
// `magnetUrl`, and their `guid` is a plain result-page URL with no embeddable hash — so a fetch
// of the release's own download URL is the only way left to learn its real infoHash. Since
// `037-indexer-result-loss` this only ever runs for one release at a time, on the add path, when
// the user has deliberately clicked it — never during a search, where firing it for every
// unresolvable row at once is what silently dropped a third of every result set.
const RESOLVE_INFO_HASH_TIMEOUT_MS = 8000;

function extractInfoHashFromMagnet(magnet: string): string | null {
  const match = magnet.match(/xt=urn:btih:([^&]+)/i);
  return match ? match[1].toLowerCase() : null;
}

// Tries each URL in order — a `magnet:` URL is parsed directly, anything else is fetched with
// `redirect: 'manual'` and either followed to a magnet redirect or parsed as a `.torrent`. Throws
// a keyed `i18nError` rather than ever returning a falsy hash: a hash that does not match what
// qBittorrent later reports leaves the download stuck in `DOWNLOADING` forever with no error
// anywhere (see `downloads.service.ts::handleTorrentCompleted`, which matches by hash alone).
export async function resolveInfoHash(
  urls: string[],
  timeoutMs = RESOLVE_INFO_HASH_TIMEOUT_MS,
): Promise<string> {
  for (const url of urls) {
    if (!url) continue;

    if (url.startsWith('magnet:')) {
      const hash = extractInfoHashFromMagnet(url);
      if (hash) return hash;
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status === 301 || response.status === 302) {
        const location = response.headers.get('location');
        if (location?.startsWith('magnet:')) {
          const hash = extractInfoHashFromMagnet(location);
          if (hash) return hash;
        }
        continue;
      }

      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const { default: parseTorrent } = await import('parse-torrent');
        const parsed = await parseTorrent(buffer);
        return parsed.infoHash.toLowerCase();
      }
    } catch {
      // This URL failed to resolve; fall through and try the next one.
    } finally {
      clearTimeout(timer);
    }
  }

  throw i18nError.badRequest(ERROR_KEYS.INDEXER_NO_INFOHASH);
}
