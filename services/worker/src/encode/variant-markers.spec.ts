// Markers added to the shared Spanish table fail silently: a case-insensitive `id` would read every "Tu ID, por favor" as Castilian,
// a missing word boundary would read `guay` inside `guayabera` as dialect, and a Latin marker with the wrong sign would push a
// Latin file towards Spain. Each class below scores real sentences through the real scorer and table.

import { describe, expect, it } from 'vitest';

import { findAudioVariantDetector } from './variant-detectors';
import { score } from './variant-score';

const markers = findAudioVariantDetector('spa')!.markers;
const scoreOf = (text: string) => score(text, markers);

describe('id (case-sensitive imperative)', () => {
  it('counts nothing for ID in upper case, mid-cue or first word', () => {
    expect(scoreOf('Tu ID, por favor')).toBe(0);
    expect(scoreOf('ID, por favor')).toBe(0);
  });

  it('counts lower case id anywhere in the cue', () => {
    expect(scoreOf('Y ahora id a casa')).toBe(3);
  });

  it('counts Id as the first word of a cue, also after a dialogue dash', () => {
    expect(scoreOf('Id a casa')).toBe(3);
    expect(scoreOf('- Id a casa')).toBe(3);
    expect(scoreOf('Hola\nId a casa')).toBe(3);
  });

  it('counts nothing for Id in the middle of a cue', () => {
    expect(scoreOf('Tu Id, por favor')).toBe(0);
  });

  it('does not match inside a longer word', () => {
    expect(scoreOf('idea, idiota, vid')).toBe(0);
  });
});

describe('Spain markers', () => {
  it.each(['curro', 'currar', 'guay', 'chaval', 'chavales', 'gilipollas', 'hostia', 'hostias'])(
    'strong marker %s scores 3',
    (marker) => {
      expect(scoreOf(`Qué ${marker} más raro`)).toBe(3);
    },
  );

  it.each(['mola', 'flipar', 'venga', 'piso', 'pasta'])('weak marker %s scores 1', (marker) => {
    expect(scoreOf(`Qué ${marker} más raro`)).toBe(1);
  });

  it('does not match inside longer words', () => {
    expect(scoreOf('guayabera, pastaza, pisotear, convenga, molaris, hostil')).toBe(0);
  });
});

describe('Latin American markers', () => {
  it.each(['rentar', 'enojado', 'enojada', 'apúrate', 'chamaco', 'güey', 'chido'])(
    'marker %s scores -2',
    (marker) => {
      expect(scoreOf(`Qué ${marker} más raro`)).toBe(-2);
    },
  );

  it('departamento is weak at -1, since Spain also says it for a company department', () => {
    expect(scoreOf('Mi departamento es grande')).toBe(-1);
  });

  it('a capitalised marker still matches', () => {
    expect(scoreOf('Güey, qué chido')).toBe(-4);
  });
});
