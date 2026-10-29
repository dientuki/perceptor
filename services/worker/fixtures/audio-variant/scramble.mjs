import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [, , seedName, outDir, ...inputs] = process.argv;
if (!seedName || !outDir || inputs.length === 0) {
  console.error('usage: node scramble.mjs <seed> <out dir> <index=file>...');
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

const START = '(?<![\\p{L}\\p{N}_])';
const END = '(?![\\p{L}\\p{N}_])';
const WORD = '[\\p{L}\\p{N}_]';
const MARKERS = [
  'vosotr[oa]s', 'os', `${WORD}+(?:áis|éis)`, 'a por', 'vale', 'jod(?:er|an|e)', 'tí[oa]',
  'coche', 'ordenador', 'móvil', 'conducir', 'zumo', 'gafas', 'valeroso',
  `(?:he|has|ha|hemos|habéis|han)\\s+${WORD}+(?:ado|ido|to|cho|sto)`,
  'ustedes', 'carajo', 'ahorita', 'platica\\p{L}*', 'manej\\p{L}*', 'celular', 'computadora', 'carro', 'jugo',
  'lentes', 'qué pasó', 'okey',
].map((p) => new RegExp(`${START}(?:${p})${END}`, 'gu'));

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

const scrambleLine = (line) => {
  const lower = line.toLowerCase();
  const kept = [];
  for (const marker of MARKERS) for (const m of lower.matchAll(marker)) kept.push([m.index, m.index + m[0].length]);
  return line.replace(/\p{L}+/gu, (word, offset) =>
    kept.some(([from, to]) => offset < to && offset + word.length > from) ? word : scrambleWord(word),
  );
};

mkdirSync(outDir, { recursive: true });
for (const input of inputs) {
  const [index, file] = input.split('=');
  const text = readFileSync(file, 'utf8').replace(/\r/g, '');
  writeFileSync(join(outDir, `${index}.txt`), text.split('\n').map(scrambleLine).join('\n'));
  console.log(`${basename(file)} -> ${index}.txt`);
}
