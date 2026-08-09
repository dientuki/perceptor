import { parseMagnet } from './magnet';

// Par hex/base32 verificado por separado (mismos 20 bytes, dos codificaciones
// legales del mismo infoHash — ver el comentario en magnet.ts).
const HEX = '5d4a2f1c8e3b9a7d6c5e4f3a2b1c0d9e8f7a6b5c';
const BASE32 = 'LVFC6HEOHONH23C6J45CWHANT2HXU224';

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
    expect(() => parseMagnet('magnet:?xt=urn:btmh:1220deadbeef&dn=V2Only')).toThrow(
      /BitTorrent v2/,
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
    expect(() => parseMagnet('')).toThrow('No parece un magnet link');
  });

  it('rechaza una URL http (no magnet)', () => {
    expect(() => parseMagnet('https://tracker.example/download/123.torrent')).toThrow(
      'No parece un magnet link',
    );
  });

  it('rechaza un magnet sin xt', () => {
    expect(() => parseMagnet('magnet:?dn=SinHash')).toThrow('El magnet no tiene un infoHash válido');
  });

  it('rechaza un infoHash con longitud inválida', () => {
    expect(() => parseMagnet('magnet:?xt=urn:btih:deadbeef')).toThrow(
      'El magnet no tiene un infoHash válido',
    );
  });
});
