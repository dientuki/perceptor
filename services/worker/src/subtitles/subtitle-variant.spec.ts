// Defends against a downloaded subtitle whose dialect is misjudged or whose
// check throws: a cp1252 file scored differently from its UTF-8 copy, an empty
// or unreadable file failing the sync job, a middling rate forced into a tag,
// or a language with no detector getting one. Each yields a wrong or lost
// variant tag with no error anywhere.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { detectDownloadedVariant } from './subtitle-variant';

const dir = mkdtempSync(join(tmpdir(), 'subtitle-variant-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

function srt(lines: string[]): string {
  return lines.map((line, i) => `${i + 1}\n00:00:${String(i % 60).padStart(2, '0')},000 --> 00:00:${String(i % 60).padStart(2, '0')},900\n<i>${line}</i>\n`).join('\n');
}

const NEUTRAL = (n: number) => Array.from({ length: n }, (_, i) => `La casa grande número ${i} está en la calle principal`);
const SPAIN = (n: number) => Array.from({ length: n }, (_, i) => `Vosotros sois tíos guay, vale, venga ${i} chaval`);
const LATIN = (n: number) => Array.from({ length: n }, (_, i) => `Ustedes manejan la computadora y el carro ${i} ahorita`);

function write(name: string, content: string | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe('detectDownloadedVariant', () => {
  it('decides es-ES for a clear Spain file', async () => {
    expect(await detectDownloadedVariant(write('spain.srt', srt(SPAIN(200))), 'spa')).toBe('es-ES');
  });

  it('decides es-419 for a clear Latin file', async () => {
    expect(await detectDownloadedVariant(write('latin.srt', srt(LATIN(200))), 'spa')).toBe('es-419');
  });

  it('scores a Windows-1252 file the same as its UTF-8 copy', async () => {
    const text = srt([...SPAIN(150), 'Señor, ¿qué pasó? Está aquí por él', ...NEUTRAL(50)]);
    const utf8 = await detectDownloadedVariant(write('u8.srt', Buffer.from(text, 'utf8')), 'spa');
    const cp = await detectDownloadedVariant(write('cp.srt', Buffer.from(text, 'latin1')), 'spa');
    expect(utf8).toBe('es-ES');
    expect(cp).toBe(utf8);
  });

  it('returns null and logs for a zero-byte file', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await detectDownloadedVariant(write('empty.srt', ''), 'spa')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns null and logs for a missing file instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await detectDownloadedVariant(join(dir, 'missing.srt'), 'spa')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns null for a rate between the two thresholds', async () => {
    const lines = [...NEUTRAL(190), ...Array.from({ length: 2 }, (_, i) => `Vale ${i} chaval`)];
    expect(await detectDownloadedVariant(write('gap.srt', srt(lines)), 'spa')).toBeNull();
  });

  it('logs one subvariant line for a decided and for an undecided file', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await detectDownloadedVariant(write('logged-latin.srt', srt(LATIN(200))), 'spa');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[subvariant\] spa logged-latin\.srt -?[\d.]+\/kw \u2192 es-419$/);
    log.mockClear();
    await detectDownloadedVariant(write('logged-short.srt', srt(NEUTRAL(5))), 'spa');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toBe('[subvariant] spa logged-short.srt n/a/kw \u2192 undecided');
  });

  it('returns null when the language has no detector', async () => {
    expect(await detectDownloadedVariant(write('fr.srt', srt(SPAIN(200))), 'fra')).toBeNull();
  });
});
