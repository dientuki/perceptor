import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';

export type ParsedMagnet = { infoHash: string; displayName: string | null };

const HEX_40 = /^[0-9a-f]{40}$/i;
const BASE32_32 = /^[A-Z2-7]{32}$/i;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// RFC 4648 sin padding: 32 chars base32 = 160 bits = 20 bytes = el infoHash.
function base32ToHex(value: string): string {
  let bits = '';
  for (const char of value.toUpperCase()) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Saca el infoHash v1 (xt=urn:btih:) y el nombre (dn=) de un magnet link.
// Sin red: sólo parseo de string, pero SÍ importa de src/i18n — es un
// `clients/` module, no un módulo Nest con DI, así que no hay ciclo ni
// acoplamiento raro en tirar una i18nError real acá (018 T010). Tira una
// BadRequestException ya keyed — nunca devuelve un hash a medias, porque un
// hash que no coincide con el que reporta qBittorrent deja la descarga
// colgada para siempre y sin ningún error (ver
// downloads.service.ts::handleTorrentCompleted, que sólo matchea por hash).
export function parseMagnet(magnet: string): ParsedMagnet {
  if (!magnet.startsWith('magnet:?')) {
    throw i18nError.badRequest(ERROR_KEYS.MAGNET_NOT_A_MAGNET);
  }

  const params = new URLSearchParams(magnet.slice('magnet:?'.length));
  // Un magnet híbrido v1+v2 trae varios `xt`: uno urn:btih (v1) y otro
  // urn:btmh (v2). URLSearchParams.getAll conserva el orden de aparición.
  const xts = params.getAll('xt');

  const btih = xts
    .map((xt) => xt.match(/^urn:btih:(.+)$/i)?.[1])
    .find((value): value is string => Boolean(value));

  if (btih) {
    if (HEX_40.test(btih)) return { infoHash: btih.toLowerCase(), displayName: readDisplayName(params) };
    if (BASE32_32.test(btih)) return { infoHash: base32ToHex(btih), displayName: readDisplayName(params) };
    throw i18nError.badRequest(ERROR_KEYS.MAGNET_INVALID_INFOHASH);
  }

  const hasV2Only = xts.some((xt) => /^urn:btmh:/i.test(xt));
  if (hasV2Only) {
    throw i18nError.badRequest(ERROR_KEYS.MAGNET_V2_UNSUPPORTED);
  }

  throw i18nError.badRequest(ERROR_KEYS.MAGNET_INVALID_INFOHASH);
}

function readDisplayName(params: URLSearchParams): string | null {
  return params.get('dn');
}
