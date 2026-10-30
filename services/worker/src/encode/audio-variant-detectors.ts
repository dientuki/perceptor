const START = '(?<![\\p{L}\\p{N}_])';
const END = '(?![\\p{L}\\p{N}_])';
const WORD = '[\\p{L}\\p{N}_]';

function word(pattern: string): RegExp {
  return new RegExp(`${START}(?:${pattern})${END}`, 'gu');
}

export interface AudioVariantMarkers {
  strongA: RegExp[];
  weakA: RegExp[];
  presentPerfect: RegExp[];
  b: RegExp[];
}

export interface AudioVariantDetector {
  iso3: string;
  whisperLanguage: string;
  tags: [aTag: string, bTag: string];
  markers: AudioVariantMarkers;
}

export const AUDIO_VARIANT_DETECTORS: readonly AudioVariantDetector[] = [
  {
    iso3: 'spa',
    whisperLanguage: 'es',
    tags: ['es-ES', 'es-419'],
    markers: {
      strongA: [
        word('vosotr[oa]s'),
        word('os'),
        word(`${WORD}+(?:áis|éis)`),
        word('a por'),
        word('vale'),
        word('jod(?:er|an|e)'),
        word('tí[oa]'),
      ],
      weakA: [
        word('coche'),
        word('ordenador'),
        word('móvil'),
        word('conducir'),
        word('zumo'),
        word('gafas'),
        word('valeroso'),
      ],
      presentPerfect: [word(`(?:he|has|ha|hemos|habéis|han)\\s+${WORD}+(?:ado|ido|to|cho|sto)`)],
      b: [
        word('ustedes'),
        word('carajo'),
        word('ahorita'),
        word('platica\\p{L}*'),
        word('manej\\p{L}*'),
        word('celular'),
        word('computadora'),
        word('carro'),
        word('jugo'),
        word('lentes'),
        word('qué pasó'),
        word('okey'),
      ],
    },
  },
];

export function findAudioVariantDetector(iso3: string): AudioVariantDetector | undefined {
  return AUDIO_VARIANT_DETECTORS.find((entry) => entry.iso3 === iso3);
}
