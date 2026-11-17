import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { findAudioVariantDetector } from '../encode/variant-detectors';
import { decideAbsolute, scoreRate } from '../encode/variant-score';
import { decodeSubtitleBytes } from './normalize-srt';

const TIMING_LINE = /^\s*\d+:\d{2}:\d{2}[,.]\d{1,3}\s*-->.*$/;
const INDEX_LINE = /^\s*\d+\s*$/;

function cueText(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !TIMING_LINE.test(line) && !INDEX_LINE.test(line))
    .join('\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '');
}

// Spec 118, REQ-12 REQ-14 REQ-17
export async function detectDownloadedVariant(path: string, iso3: string): Promise<string | null> {
  const detector = findAudioVariantDetector(iso3);
  if (!detector) return null;
  try {
    const bytes = await readFile(path);
    if (bytes.length === 0) {
      console.warn(`[subtitle-variant] ${path} is empty, variant undecided`);
      return null;
    }
    const text = cueText(decodeSubtitleBytes(bytes, path));
    const rate = scoreRate(text, detector.markers);
    const verdict = decideAbsolute(text, detector);
    console.log(`[subvariant] ${iso3} ${basename(path)} ${rate === null ? 'n/a' : rate.toFixed(1)}/kw \u2192 ${verdict ?? 'undecided'}`);
    return verdict;
  } catch (error) {
    console.warn(`[subtitle-variant] could not check ${path}, variant undecided: ${(error as Error).message}`);
    return null;
  }
}
