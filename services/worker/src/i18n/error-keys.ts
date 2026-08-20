// Transcribed by hand from docs/spec/features/018-ui-i18n/spec.md's
// "Error table — worker" section, which is the frozen source of truth
// (Constitution, Article VIII). No compiler checks this list against
// services/api/src/i18n/error-keys.ts — the Docker build context
// (./services/worker) physically cannot see ../api, same reasoning as
// src/queue/types.ts's hand-sync rule.
//
// Three keys below are NOT owned by this service — they are api's, spelled
// identically on purpose, because they are the same key, not a worker-local
// variant: ERROR_PROCESS_JOB_NOT_FOUND, ERROR_SOURCE_NO_TARGET,
// ERROR_SOURCE_NO_DOWNLOAD_PATH. Confirmed against
// services/api/src/i18n/error-keys.ts:
//   error.processJob.not_found
//   error.source.no_target
//   error.source.no_download_path

export const ERROR_ENCODE_NO_VIDEO_STREAM = 'error.encode.no_video_stream';
export const ERROR_ENCODE_NO_ORIGINAL_AUDIO = 'error.encode.no_original_audio';
export const ERROR_ENCODE_PROBE_FAILED = 'error.encode.probe_failed';
export const ERROR_ENCODE_FFMPEG_FAILED = 'error.encode.ffmpeg_failed';
export const ERROR_ENCODE_NO_OUTPUT = 'error.encode.no_output';
export const ERROR_ENCODE_MKVMERGE_FAILED = 'error.encode.mkvmerge_failed';
export const ERROR_ENCODE_EPISODE_NUMBERS_MISSING = 'error.encode.episode_numbers_missing';
export const ERROR_ENCODE_UNKNOWN_DRIVER = 'error.encode.unknown_driver';

// Not in ../spec.md's error table — added by T033 as the mandatory fallback
// for a throw that is not a KeyedError (a bug, an uncaught library error).
// encodeFailed's errorKey is required (REQ-11): there is no path where a
// failure reports with no key, so an unexpected throw still needs one.
export const ERROR_ENCODE_UNEXPECTED = 'error.encode.unexpected';

// api-owned — spelled identically to services/api/src/i18n/error-keys.ts.
export const ERROR_PROCESS_JOB_NOT_FOUND = 'error.processJob.not_found';
export const ERROR_SOURCE_NO_TARGET = 'error.source.no_target';
export const ERROR_SOURCE_NO_DOWNLOAD_PATH = 'error.source.no_download_path';
