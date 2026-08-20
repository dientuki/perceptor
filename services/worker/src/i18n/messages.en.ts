// English rendering for every key in error-keys.ts, used as the required
// `errorMessage` argument to `encodeFailed` (docs/spec/graphql-contract.md).
// `{param}` placeholders are filled by renderMessage below with the values
// carried on KeyedError.params — this is the sentence that ends up in
// ProcessJob.errorMessage and in api's/worker's logs, per NFR-3.

import {
  ERROR_ENCODE_EPISODE_NUMBERS_MISSING,
  ERROR_ENCODE_FFMPEG_FAILED,
  ERROR_ENCODE_MKVMERGE_FAILED,
  ERROR_ENCODE_NO_ORIGINAL_AUDIO,
  ERROR_ENCODE_NO_OUTPUT,
  ERROR_ENCODE_NO_VIDEO_STREAM,
  ERROR_ENCODE_PROBE_FAILED,
  ERROR_ENCODE_UNEXPECTED,
  ERROR_ENCODE_UNKNOWN_DRIVER,
  ERROR_PROCESS_JOB_NOT_FOUND,
  ERROR_SOURCE_NO_DOWNLOAD_PATH,
  ERROR_SOURCE_NO_TARGET,
} from './error-keys';

export const messagesEn: Record<string, string> = {
  [ERROR_ENCODE_NO_VIDEO_STREAM]: 'The input file has no video stream',
  [ERROR_ENCODE_NO_ORIGINAL_AUDIO]:
    'The file has no audio track in the original language ({iso3})',
  [ERROR_ENCODE_PROBE_FAILED]: 'Could not analyse the video file ({filePath}): {detail}',
  [ERROR_ENCODE_FFMPEG_FAILED]: 'ffmpeg exited with code {code}: {stderr}',
  [ERROR_ENCODE_NO_OUTPUT]: 'ffmpeg exited 0 but produced no {path}',
  [ERROR_ENCODE_MKVMERGE_FAILED]: 'mkvmerge failed with code {code}: {stderr}',
  [ERROR_ENCODE_EPISODE_NUMBERS_MISSING]:
    'Episode has no season/episode number: cannot build the output path',
  [ERROR_ENCODE_UNKNOWN_DRIVER]: 'Unknown ENCODE_DRIVER: {driver}',
  [ERROR_ENCODE_UNEXPECTED]: 'Unexpected encode failure: {detail}',
  [ERROR_PROCESS_JOB_NOT_FOUND]: 'Process job {id} does not exist',
  [ERROR_SOURCE_NO_DOWNLOAD_PATH]:
    'Completed with no download path recorded — cannot enqueue',
  [ERROR_SOURCE_NO_TARGET]: 'Media source {id} points at no movie, episode or season',
};

// Fills `{param}` placeholders in a message template with the corresponding
// value from `params`. A placeholder with no matching param is left as-is
// rather than silently dropped, so a missing param is visible in the row
// instead of producing a message with a hole in it.
export function renderMessage(
  key: string,
  params?: Record<string, string | number>,
): string {
  const template = messagesEn[key];
  if (!template) {
    throw new Error(`No English message registered for i18n key "${key}"`);
  }
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
