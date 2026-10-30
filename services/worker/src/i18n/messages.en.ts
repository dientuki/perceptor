// Spec 018, REQ-11

import {
  ERROR_ENCODE_DISC_REMUX_FAILED,
  ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS,
  ERROR_ENCODE_DISCARDED,
  ERROR_ENCODE_STOPPED,
  ERROR_ENCODE_EPISODE_NUMBERS_MISSING,
  ERROR_ENCODE_FFMPEG_FAILED,
  ERROR_ENCODE_MKVMERGE_FAILED,
  ERROR_ENCODE_MOVE_FAILED,
  ERROR_ENCODE_NO_ORIGINAL_AUDIO,
  ERROR_ENCODE_NO_OUTPUT,
  ERROR_ENCODE_NO_VIDEO_STREAM,
  ERROR_ENCODE_PROBE_FAILED,
  ERROR_ENCODE_UNEXPECTED,
  ERROR_ENCODE_UNKNOWN_DRIVER,
  ERROR_PROCESS_JOB_NOT_FOUND,
  ERROR_SOURCE_NO_DOWNLOAD_PATH,
  ERROR_SOURCE_NO_TARGET,
  ERROR_SOURCE_SCAN_FAILED,
  ERROR_SUBTITLE_EMBED_CHARSET_UNDETECTED,
  ERROR_SUBTITLE_EMBED_NOT_WRITABLE,
  ERROR_SUBTITLE_EMBED_REMUX_FAILED,
  ERROR_SUBTITLE_EMBED_SIDECAR_DELETE_FAILED,
  ERROR_SUBTITLE_EMBED_SUBTITLE_UNREADABLE,
  ERROR_SUBTITLE_EMBED_VERIFY_FAILED,
  ERROR_SUBTITLE_SEARCH_INTERRUPTED,
  ERROR_SUBTITLE_SEARCH_PROBE_FAILED,
  ERROR_SUBTITLE_EMBED_SYNC_FAILED,
  ERROR_SUBTITLE_SEARCH_SYNC_FAILED,
} from './error-keys';

export const messagesEn: Record<string, string> = {
  [ERROR_ENCODE_NO_VIDEO_STREAM]: 'The input file has no video stream',
  [ERROR_ENCODE_NO_ORIGINAL_AUDIO]:
    'The file has no audio track in the original language ({iso3})',
  [ERROR_ENCODE_PROBE_FAILED]: 'Could not analyse the video file ({filePath}): {detail}',
  [ERROR_ENCODE_FFMPEG_FAILED]: 'ffmpeg exited with code {code}: {stderr}',
  [ERROR_ENCODE_NO_OUTPUT]: 'ffmpeg exited 0 but produced no {path}',
  [ERROR_ENCODE_MKVMERGE_FAILED]: 'mkvmerge failed with code {code}: {stderr}',
  [ERROR_ENCODE_MOVE_FAILED]: 'Could not move the file to its destination: {detail}',
  [ERROR_ENCODE_EPISODE_NUMBERS_MISSING]:
    'Episode has no season/episode number: cannot build the output path',
  [ERROR_ENCODE_UNKNOWN_DRIVER]: 'Unknown ENCODE_DRIVER: {driver}',
  [ERROR_ENCODE_DISCARDED]: 'Encode was discarded by the user',
  [ERROR_ENCODE_STOPPED]: 'Encode was stopped by the user',
  [ERROR_ENCODE_UNEXPECTED]: 'Unexpected encode failure: {detail}',
  [ERROR_PROCESS_JOB_NOT_FOUND]: 'Process job {id} does not exist',
  [ERROR_SOURCE_NO_DOWNLOAD_PATH]:
    'Completed with no download path recorded — cannot enqueue',
  [ERROR_SOURCE_NO_TARGET]: 'Media source {id} points at no movie, episode or season',
  [ERROR_SOURCE_SCAN_FAILED]: 'The download could not be read: {detail}',
  [ERROR_SOURCE_DISC_PLAYLIST_AMBIGUOUS]:
    "Could not determine the Blu-ray's main playlist ({playlists}). Assemble the MKV manually and import it from the film's page",
  [ERROR_ENCODE_DISC_REMUX_FAILED]:
    'Could not assemble the MKV from the Blu-ray (code {code}): {stderr}',
  [ERROR_SUBTITLE_EMBED_SUBTITLE_UNREADABLE]: 'Could not read subtitle file {file}: {detail}',
  [ERROR_SUBTITLE_EMBED_CHARSET_UNDETECTED]:
    'Could not detect the character encoding of subtitle file {file}',
  [ERROR_SUBTITLE_EMBED_REMUX_FAILED]: 'Subtitle embed failed: {detail}',
  [ERROR_SUBTITLE_EMBED_VERIFY_FAILED]: 'The remuxed file failed verification: {detail}',
  [ERROR_SUBTITLE_EMBED_NOT_WRITABLE]:
    'The library folder is not writable or the file owner cannot be preserved: {detail}',
  [ERROR_SUBTITLE_EMBED_SIDECAR_DELETE_FAILED]:
    'Subtitles embedded, but the external .srt file could not be deleted',
  [ERROR_SUBTITLE_EMBED_SYNC_FAILED]: 'The subtitle offset could not be measured.',
  [ERROR_SUBTITLE_SEARCH_SYNC_FAILED]:
    "The subtitle's synchronization could not be validated.",
  [ERROR_SUBTITLE_SEARCH_INTERRUPTED]: 'The search was interrupted.',
  [ERROR_SUBTITLE_SEARCH_PROBE_FAILED]: 'The library file could not be inspected.',
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
