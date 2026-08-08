import type { EncodeFn } from './types';
import { encodeMock } from './encode.mock';
import { encodeFfmpeg } from './encode.ffmpeg';

// Punto de sutura entre el workflow (probado con el mock) y FFmpeg real: el
// día que se porte services/worker/src/ffmpeg/, cambia ENCODE_DRIVER, no el
// resto del pipeline.
const DRIVERS: Record<string, EncodeFn> = {
  mock: encodeMock,
  ffmpeg: encodeFfmpeg,
};

export const encode: EncodeFn = (input, output, onProgress) => {
  const driverName = process.env.ENCODE_DRIVER ?? 'mock';
  const driver = DRIVERS[driverName];
  if (!driver) {
    throw new Error(`ENCODE_DRIVER desconocido: ${driverName}`);
  }

  return driver(input, output, onProgress);
};
