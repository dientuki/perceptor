import { HttpException } from '@nestjs/common';

import { ERROR_KEYS, ErrorKey } from '@/i18n/error-keys';

import { parseMagnet } from './magnet';

// Par hex/base32 verificado por separado (mismos 20 bytes, dos codificaciones
// legales del mismo infoHash — ver el comentario en magnet.ts).
const HEX = '5d4a2f1c8e3b9a7d6c5e4f3a2b1c0d9e8f7a6b5c';
const BASE32 = 'LVFC6HEOHONH23C6J45CWHANT2HXU224';

// Since 018-ui-i18n, api throw sites carry an i18n key rather than a Spanish
// sentence (`web`/`worker` render the sentence from the key); assert on the
// key instead of message substrings, or a call site could point at the wrong
// key while `.toThrow(/.../ )` still passes on the English fallback text.
function expectI18nKey(fn: () => unknown, key: ErrorKey): void {
  try {
    fn();
    throw new Error('expected fn to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const response = (error as HttpException).getResponse() as { i18n?: { key: string } };
    expect(response.i18n?.key).toBe(key);
  }
}

describe('parseMagnet', () => {
  it('normaliza un infoHash hex en mayúsculas a minúsculas', () => {
    const result = parseMagnet(`magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=Test`);
    expect(result.infoHash).toBe(HEX);
  });

  it('decodifica un infoHash en base32 al hex equivalente', () => {
    const result = parseMagnet(`magnet:?xt=urn:btih:${BASE32}&dn=Test`);
    expect(result.infoHash).toBe(HEX);
  });

  it('en un magnet híbrido v1+v2, usa el v1 (btih)', () => {
    const result = parseMagnet(
      `magnet:?xt=urn:btmh:1220deadbeef&xt=urn:btih:${HEX}&dn=Hybrid`,
    );
    expect(result.infoHash).toBe(HEX);
  });

  it('tira un error legible para un magnet de BitTorrent v2 puro (sólo btmh)', () => {
    expectI18nKey(
      () => parseMagnet('magnet:?xt=urn:btmh:1220deadbeef&dn=V2Only'),
      ERROR_KEYS.MAGNET_V2_UNSUPPORTED,
    );
  });

  it('decodifica el dn con espacios y símbolos codificados', () => {
    const result = parseMagnet(`magnet:?xt=urn:btih:${HEX}&dn=Dune+%282021%29+1080p`);
    expect(result.displayName).toBe('Dune (2021) 1080p');
  });

  it('devuelve displayName null cuando no hay dn', () => {
    const result = parseMagnet(`magnet:?xt=urn:btih:${HEX}`);
    expect(result.displayName).toBeNull();
  });

  it('rechaza un string vacío', () => {
    expectI18nKey(() => parseMagnet(''), ERROR_KEYS.MAGNET_NOT_A_MAGNET);
  });

  it('rechaza una URL http (no magnet)', () => {
    expectI18nKey(
      () => parseMagnet('https://tracker.example/download/123.torrent'),
      ERROR_KEYS.MAGNET_NOT_A_MAGNET,
    );
  });

  it('rechaza un magnet sin xt', () => {
    expectI18nKey(() => parseMagnet('magnet:?dn=SinHash'), ERROR_KEYS.MAGNET_INVALID_INFOHASH);
  });

  it('rechaza un infoHash con longitud inválida', () => {
    expectI18nKey(
      () => parseMagnet('magnet:?xt=urn:btih:deadbeef'),
      ERROR_KEYS.MAGNET_INVALID_INFOHASH,
    );
  });
});
