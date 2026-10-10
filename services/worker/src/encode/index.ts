import type { EncodeFn } from './types';
import { encodeMock } from './encode.mock';
import { encodeFfmpeg } from './encode.ffmpeg';
import { KeyedError } from '../i18n/keyed-error';
import { renderMessage } from '../i18n/messages.en';
import { ERROR_ENCODE_UNKNOWN_DRIVER } from '../i18n/error-keys';

const DRIVERS: Record<string, EncodeFn> = {
  mock: encodeMock,
  ffmpeg: encodeFfmpeg,
};

export const encode: EncodeFn = (input, output, details, onProgress, onProbe, signal) => {
  const driverName = process.env.ENCODE_DRIVER ?? 'mock';
  const driver = DRIVERS[driverName];
  if (!driver) {
    const params = { driver: driverName };
    throw new KeyedError(
      ERROR_ENCODE_UNKNOWN_DRIVER,
      renderMessage(ERROR_ENCODE_UNKNOWN_DRIVER, params),
      params,
    );
  }

  return driver(input, output, details, onProgress, onProbe, signal);
};
