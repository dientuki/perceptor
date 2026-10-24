import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [, , sourceDir, outDir, seedName = basename(sourceDir)] = process.argv;
if (!sourceDir || !outDir) {
  console.error('usage: node scramble.mjs <dir with N.srt> <out dir> [seed]');
  process.exit(1);
}

let state = [...seedName].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const map = new Map();
const used = new Set();

const replacement = (word) => {
  const key = word.toLowerCase();
  if ([...key].length <= 2) return key;
  let rep = map.get(key);
  while (rep === undefined) {
    const candidate = Array.from(key, (c) =>
      LETTERS.includes(c) ? LETTERS[Math.floor(random() * LETTERS.length)] : c,
    ).join('');
    if (!used.has(candidate) && candidate !== key) {
      used.add(candidate);
      map.set(key, candidate);
      rep = candidate;
    }
  }
  return rep;
};

const scrambleWord = (word) => {
  const rep = [...replacement(word)];
  return [...word]
    .map((c, i) => (!LETTERS.includes(rep[i]) ? c : c !== c.toLowerCase() ? rep[i].toUpperCase() : rep[i]))
    .join('');
};

const scrambleText = (line) =>
  line
    .split(/(<[^>]*>|\{[^}]*\})/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\p{L}+/gu, scrambleWord)))
    .join('');

const TIMING = /^\d+:\d+:\d+[,.]\d+\s+-->\s+\d+:\d+:\d+[,.]\d+/;

const scrambleSrt = (text) =>
  text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n');
      const timing = lines.findIndex((l) => TIMING.test(l));
      if (timing < 0) return block;
      return [...lines.slice(0, timing + 1), ...lines.slice(timing + 1).map(scrambleText)].join('\n');
    })
    .join('\n\n');

mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(sourceDir).filter((f) => f.endsWith('.srt')).sort()) {
  writeFileSync(join(outDir, file), scrambleSrt(readFileSync(join(sourceDir, file), 'utf8')));
}
