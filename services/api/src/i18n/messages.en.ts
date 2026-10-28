import { ERROR_KEYS } from '@/i18n/error-keys';

/**
 * English rendering for every key in `error-keys.ts`, keyed by the key string
 * itself (not the constant name), so a lookup by `extensions.i18n.key` at the
 * formatter or in a test needs no reverse mapping.
 *
 * `{param}` placeholders match the "Params" column of `spec.md`'s error tables
 * exactly — the factories in `i18n-error.ts` are responsible for supplying them.
 * This file only ever produces English (`api/plan.md` § Scope): translating a key
 * into another language is `web`'s job.
 */
export const MESSAGES_EN: Record<string, string> = {
  // auth
  [ERROR_KEYS.AUTH_UNAUTHENTICATED]: 'Not authenticated',
  [ERROR_KEYS.AUTH_SESSION_EXPIRED]: 'Your session expired, sign in again',
  [ERROR_KEYS.AUTH_INVALID_CREDENTIALS]: 'Invalid credentials',
  [ERROR_KEYS.AUTH_ACCOUNT_DISABLED]: 'Your account is disabled',
  [ERROR_KEYS.AUTH_ADMIN_REQUIRED]:
    'You do not have permission to manage users',

  // users
  [ERROR_KEYS.USER_USERNAME_TAKEN]: 'That username is already registered',
  [ERROR_KEYS.USER_NOT_FOUND]: 'User "{id}" not found',
  [ERROR_KEYS.USER_CANNOT_DISABLE_SELF]: 'You cannot disable your own user',
  [ERROR_KEYS.USER_CANNOT_DISABLE_LAST_ADMIN]:
    'You cannot disable the only administrator',
  [ERROR_KEYS.USER_CANNOT_DELETE_SELF]: 'You cannot delete your own user',
  [ERROR_KEYS.USER_CANNOT_DELETE_LAST_ADMIN]:
    'You cannot delete the only administrator',
  [ERROR_KEYS.USER_UNSUPPORTED_LOCALE]: 'Locale "{locale}" is not supported',

  // movies, shows, seasons, episodes
  [ERROR_KEYS.MOVIE_NOT_FOUND]: 'Movie {id} does not exist',
  [ERROR_KEYS.MOVIE_NOT_IN_CATALOG]:
    'We could not find that movie in the catalog',
  [ERROR_KEYS.MOVIE_ALREADY_COMPLETED]:
    'This movie is already downloaded. Confirm to replace the current file.',
  [ERROR_KEYS.SHOW_NOT_AVAILABLE]: 'Resource not available for this user',
  [ERROR_KEYS.SHOW_NOT_IN_CATALOG]:
    'We could not find that series in the catalog',
  [ERROR_KEYS.SEASON_NOT_FOUND]: 'Season {id} does not exist',
  [ERROR_KEYS.SEASON_ALREADY_COMPLETED]:
    'This season already has downloaded episodes. Confirm to replace the current files.',
  [ERROR_KEYS.EPISODE_NOT_FOUND]: 'Episode {id} does not exist',
  [ERROR_KEYS.EPISODE_ALREADY_COMPLETED]:
    'This episode is already downloaded. Confirm to replace the current file.',
  [ERROR_KEYS.MAGNET_ALREADY_ATTACHED]:
    'That magnet is already attached to «{title}»',
  [ERROR_KEYS.MAGNET_ALREADY_ATTACHED_SEASON]:
    'That magnet is already attached to «{show} Season {number}»',
  [ERROR_KEYS.MEDIA_UNSUPPORTED_TYPE]: 'Unsupported media type: {type}',
  [ERROR_KEYS.MEDIA_CATALOG_UNAVAILABLE]:
    'Could not reach the catalog. Check the TMDB API key.',
  [ERROR_KEYS.MEDIA_CATALOG_UNAUTHORIZED]: 'TMDB rejected the configured API key.',
  [ERROR_KEYS.MEDIA_TYPE_DISABLED]: '{type} is disabled on this system',
  [ERROR_KEYS.MEDIA_SEARCH_UNAVAILABLE]: 'Search is disabled on this system',
  [ERROR_KEYS.MEDIA_SHORTS_DISABLED]: 'Shorts are disabled on this system',
  [ERROR_KEYS.MEDIA_REFRESH_IN_PROGRESS]: 'This title is already being refreshed, try again in a moment',
  [ERROR_KEYS.TMDB_LIST_INVALID_REFERENCE]: 'Not a TMDB list ID or link.',
  [ERROR_KEYS.TMDB_LIST_UNREADABLE]:
    'TMDB could not find the list, or it is not public.',
  [ERROR_KEYS.TMDB_LIST_ALREADY_ATTACHED]: 'This list is already attached.',
  [ERROR_KEYS.TMDB_LIST_NOT_FOUND]: 'The list does not exist.',

  // magnet parsing
  [ERROR_KEYS.MAGNET_NOT_A_MAGNET]: 'That does not look like a magnet link',
  [ERROR_KEYS.MAGNET_INVALID_INFOHASH]: 'The magnet has no valid infoHash',
  [ERROR_KEYS.MAGNET_V2_UNSUPPORTED]:
    'BitTorrent v2 magnets are not supported yet',

  // media-roots
  [ERROR_KEYS.MEDIA_ROOT_UNKNOWN]: 'Unknown media root: "{rootId}"',
  [ERROR_KEYS.MEDIA_ROOT_NOT_MOUNTED]:
    'Root "{label}" is not mounted in this container — check {envVar} in your .env and bring the stack back up',
  [ERROR_KEYS.MEDIA_ROOT_INVALID_PATH]: 'Invalid path',
  [ERROR_KEYS.MEDIA_ROOT_ABSOLUTE_PATH]:
    'The path for "{label}" must be relative to {hostPath}, not absolute',
  [ERROR_KEYS.MEDIA_ROOT_ESCAPES_ROOT]:
    'The path escapes "{label}" ({hostPath})',
  [ERROR_KEYS.MEDIA_ROOT_FOLDER_NOT_FOUND]:
    'Folder "{path}" does not exist in "{label}"',
  [ERROR_KEYS.MEDIA_ROOT_NOT_A_FOLDER]: '"{path}" is not a folder',

  // settings, languages, media-server, indexer
  [ERROR_KEYS.SETTING_NOT_EDITABLE]: 'Unknown or read-only setting: "{key}"',
  [ERROR_KEYS.SETTING_EXPECTED_BOOLEAN]: '"{key}" must be "true" or "false"',
  [ERROR_KEYS.SETTING_EXPECTED_INT]: '"{key}" must be a number',
  [ERROR_KEYS.SETTING_EXPECTED_ENUM]: '"{key}" must be one of: {options}',
  [ERROR_KEYS.SETTING_EXPECTED_ENUM_LIST]: '{key} may only contain: {options}',
  [ERROR_KEYS.SETTING_MISSING]:
    'Setting "{key}" is missing — configure it in Settings before encoding',
  [ERROR_KEYS.SETTING_EXPECTED_CRON]:
    '"{key}" must be a valid cron expression',
  [ERROR_KEYS.LANGUAGE_DUPLICATE]: 'Language {tag} is repeated',
  [ERROR_KEYS.LANGUAGE_UNAVAILABLE]: 'Language {tag} is not available',
  [ERROR_KEYS.TORRENT_GROUP_NOT_FOUND]: 'Torrent group {id} does not exist',
  [ERROR_KEYS.TORRENT_GROUP_DUPLICATED]: 'Torrent group {id} is repeated',
  [ERROR_KEYS.TORRENT_GROUP_NAME_TAKEN]:
    'A torrent group named "{name}" already exists',
  [ERROR_KEYS.MEDIA_SERVER_UNKNOWN]: 'Unknown media server: "{id}"',
  [ERROR_KEYS.MEDIA_SERVER_NOT_CONFIGURED]:
    'Configure a media server before syncing the library.',
  [ERROR_KEYS.INDEXER_UNAVAILABLE]: 'Could not reach the indexer',
  [ERROR_KEYS.INDEXER_NO_INFOHASH]: 'Could not resolve an infoHash',
  [ERROR_KEYS.SEARCH_TARGET_AMBIGUOUS]: 'Specify a single search target',

  // media-sources, process-jobs, downloads
  [ERROR_KEYS.SOURCE_NOT_FOUND]: 'Media source {id} does not exist',
  [ERROR_KEYS.SOURCE_NO_TARGET]:
    'Media source {id} points at no movie, episode or season',
  [ERROR_KEYS.SOURCE_MATCH_NOT_REPORTED]:
    'matchedFilePath {filePath} is not in the reported file list',
  [ERROR_KEYS.SOURCE_SCAN_NO_VIDEO]:
    'Scan found no main video file: empty folder or no video',
  [ERROR_KEYS.SOURCE_SCAN_NO_DOWNLOADED_VIDEO]:
    'No video file in this download has any content — check which files are selected in the torrent client',
  [ERROR_KEYS.SOURCE_NO_DOWNLOAD_PATH]:
    'Completed with no download path recorded — cannot enqueue',
  [ERROR_KEYS.SOURCE_REPLACED]: 'Replaced by a new download',
  [ERROR_KEYS.SOURCE_SUPERSEDED]: 'Another source of this title was already processing',
  [ERROR_KEYS.PROCESS_JOB_NOT_FOUND]: 'Process job {id} does not exist',
  [ERROR_KEYS.PROCESS_JOB_RECOVERY_EXHAUSTED]:
    'Automatic recovery for this encode has already been used once and failed again',
  [ERROR_KEYS.PROCESS_JOB_NOT_RESUMABLE]: 'This file cannot be retried',
  [ERROR_KEYS.PROCESS_JOB_NOT_DISCARDABLE]: 'This file can no longer be discarded',
  [ERROR_KEYS.PROCESS_JOB_NOT_RUNNING]: 'This file is not being encoded',
  [ERROR_KEYS.ENCODE_DISCARDED]: 'Encode was discarded by the user',
  [ERROR_KEYS.ENCODE_STOPPED]: 'Encode was stopped by the user',
  [ERROR_KEYS.DOWNLOAD_NOT_A_TORRENT]:
    'This download has no associated torrent',
  [ERROR_KEYS.TORRENT_CLIENT_REJECTED]:
    'The torrent client rejected the request ({status})',
  [ERROR_KEYS.TORRENT_CLIENT_UNAUTHORIZED]:
    "The torrent client rejected Perceptor's credential: an administrator needs to check TORRENT_API_KEY",

  // uploads — GraphQL
  [ERROR_KEYS.UPLOAD_TARGET_AMBIGUOUS]:
    'Provide exactly one of movieId or episodeId',

  // uploads — REST
  [ERROR_KEYS.UPLOAD_TICKET_EXPIRED]: 'The upload ticket expired, try again',
  [ERROR_KEYS.UPLOAD_TICKET_WRONG_MOVIE]:
    'The upload ticket does not belong to this movie',
  [ERROR_KEYS.UPLOAD_TICKET_WRONG_EPISODE]:
    'The upload ticket does not belong to this episode',
  [ERROR_KEYS.UPLOAD_METADATA_INCOMPLETE]: 'Upload metadata is incomplete',
  [ERROR_KEYS.UPLOAD_SUPERSEDED]: 'Superseded by a newer upload',
  [ERROR_KEYS.UPLOAD_SESSION_NOT_FOUND]:
    'Upload session {id} does not exist or is already closed',
  [ERROR_KEYS.UPLOAD_SESSION_NOT_OPEN]: 'The upload session is already closed',
  [ERROR_KEYS.UPLOAD_SESSION_EMPTY]: 'No file was uploaded to this session',
  [ERROR_KEYS.UPLOAD_SESSION_CLOSED]: 'The upload session is no longer open',
  [ERROR_KEYS.UPLOAD_TICKET_WRONG_SOURCE]:
    'The upload ticket does not belong to this session',

  // ffprobe-logs
  [ERROR_KEYS.FFPROBE_LOG_NOT_FOUND]: 'ffprobe log {id} does not exist',
  [ERROR_KEYS.FFPROBE_LOG_EMPTY_PAYLOAD]:
    'recordFfprobe requires a non-empty file and ffprobe payload',

  // Spec 101
  [ERROR_KEYS.SUBTITLE_EMBED_UNSUPPORTED_MEDIA_SERVER]:
    'Embedding subtitles requires Jellyfin as the media server.',
  [ERROR_KEYS.SUBTITLE_EMBED_MEDIA_SERVER_UNAVAILABLE]:
    'Could not reach Jellyfin. Try again in a while.',
  [ERROR_KEYS.SUBTITLE_EMBED_NO_FILE]:
    'This title has no file in the library.',
  [ERROR_KEYS.SUBTITLE_EMBED_NOT_MKV]:
    'Subtitles can only be embedded in MKV files.',
  [ERROR_KEYS.SUBTITLE_EMBED_OUTSIDE_LIBRARY]:
    "The file is not inside Perceptor's library.",
  [ERROR_KEYS.SUBTITLE_EMBED_EMPTY_SELECTION]:
    'Choose at least one subtitle.',
  [ERROR_KEYS.SUBTITLE_EMBED_MULTIPLE_DEFAULTS]:
    'Only one subtitle can be the default.',
  [ERROR_KEYS.SUBTITLE_EMBED_DUPLICATE_SUBTITLE]:
    'The same subtitle was chosen twice.',
  [ERROR_KEYS.SUBTITLE_EMBED_UNKNOWN_LANGUAGE]:
    'Unknown language: {language}.',
  [ERROR_KEYS.SUBTITLE_EMBED_OFFSET_OUT_OF_RANGE]:
    'The offset must be between -600000 and 600000 ms.',
  [ERROR_KEYS.SUBTITLE_EMBED_STALE_LISTING]:
    "Jellyfin's subtitle list changed. Reopen the dialog.",
  [ERROR_KEYS.LIBRARY_PROBE_INVALID_TARGET]:
    'The library probe target is invalid.',
  [ERROR_KEYS.LIBRARY_PROBE_NOT_FOUND]: 'The title was not found.',
  [ERROR_KEYS.LIBRARY_PROBE_MEDIA_SERVER_UNAVAILABLE]:
    'The media server is unavailable.',
  [ERROR_KEYS.SUBTITLE_EMBED_BUSY]:
    'This title has a download, encode or subtitle embed in progress.',
  [ERROR_KEYS.SUBTITLE_EMBED_SUBTITLE_UNREADABLE]:
    'One of the subtitles could not be read. The original file was not touched.',
  [ERROR_KEYS.SUBTITLE_EMBED_CHARSET_UNDETECTED]:
    "The subtitle's character encoding could not be detected.",
  [ERROR_KEYS.SUBTITLE_EMBED_REMUX_FAILED]:
    'mkvmerge failed to embed the subtitles. The original file was not touched.',
  [ERROR_KEYS.SUBTITLE_EMBED_VERIFY_FAILED]:
    'The generated file failed verification. The original was not touched.',
  [ERROR_KEYS.SUBTITLE_EMBED_NOT_WRITABLE]:
    'The worker cannot replace this file (folder or owner permissions).',
  [ERROR_KEYS.SUBTITLE_EMBED_INTERRUPTED]:
    'The embed was interrupted by a worker restart. Check the file before trying again.',
  [ERROR_KEYS.SUBTITLE_EMBED_SIDECAR_DELETE_FAILED]:
    'Subtitles embedded, but the external .srt could not be deleted. Delete it by hand or from Jellyfin.',
  [ERROR_KEYS.SUBTITLE_EMBED_JELLYFIN_REFRESH_FAILED]:
    'Subtitles embedded, but Jellyfin could not be notified. They will appear on its next scan.',

  // Spec 103
  [ERROR_KEYS.SUBTITLE_SEARCH_UNSUPPORTED_MEDIA_SERVER]:
    'Subtitle search requires Jellyfin as the media server.',
  [ERROR_KEYS.SUBTITLE_SEARCH_SYNC_NOT_FOUND]:
    'Subtitle sync check {id} does not exist',
  [ERROR_KEYS.SUBTITLE_SEARCH_ITEM_NOT_FOUND]:
    'Jellyfin did not index the file in time; no subtitles were searched.',
  [ERROR_KEYS.SUBTITLE_SEARCH_MEDIA_SERVER_UNAVAILABLE]:
    'Could not reach the media server to locate the file.',
  [ERROR_KEYS.SUBTITLE_SEARCH_FETCH_FAILED]:
    'The subtitle could not be downloaded.',
  [ERROR_KEYS.SUBTITLE_SEARCH_SYNC_FAILED]:
    "The subtitle's synchronization could not be validated.",
  [ERROR_KEYS.SUBTITLE_SEARCH_FRAMERATE_MISMATCH]:
    'The subtitle is for a version with a different framerate.',
  [ERROR_KEYS.SUBTITLE_SEARCH_OFFSET_TOO_LARGE]:
    'The subtitle is too far out of sync.',
  [ERROR_KEYS.SUBTITLE_SEARCH_INCOMPLETE]:
    'The subtitle does not cover the whole file.',
  [ERROR_KEYS.SUBTITLE_SEARCH_LOW_SCORE]:
    'The subtitle does not match this file.',
  [ERROR_KEYS.SUBTITLE_SEARCH_INTERRUPTED]:
    'The search was interrupted.',
  [ERROR_KEYS.SUBTITLE_SEARCH_SUPERSEDED]:
    'A newer delivery replaced this search.',
  [ERROR_KEYS.SUBTITLE_SEARCH_IN_PROGRESS]:
    'A subtitle search is already in progress for this title.',
  [ERROR_KEYS.SUBTITLE_SEARCH_NO_LANGUAGES]:
    'No subtitle languages are chosen for this title.',

  // Spec 107
  [ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_NOT_CONFIGURED]:
    'Subtitle search requires an OpenSubtitles account in Settings → General.',
  [ERROR_KEYS.SUBTITLE_SEARCH_NO_LIBRARY_PATH]:
    "Perceptor doesn't know where this title's file is.",
  [ERROR_KEYS.SUBTITLE_SEARCH_PROBE_NOT_FOUND]:
    'Subtitle probe {id} does not exist or is not waiting',
  [ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAUTHORIZED]:
    'OpenSubtitles rejected the username or password.',
  [ERROR_KEYS.SUBTITLE_SEARCH_PROVIDER_UNAVAILABLE]:
    'Could not reach OpenSubtitles.',
  [ERROR_KEYS.SUBTITLE_SEARCH_QUOTA_EXHAUSTED]:
    'The OpenSubtitles daily downloads are exhausted.',
  [ERROR_KEYS.SUBTITLE_SEARCH_PROBE_FAILED]:
    'The file could not be read to see which subtitles it has.',

  // scheduler
  [ERROR_KEYS.SCHEDULE_TASK_NOT_FOUND]: 'Scheduled task not found',
  [ERROR_KEYS.SCHEDULE_TASK_ALREADY_RUNNING]:
    'This scheduled task is already running',
  [ERROR_KEYS.SCHEDULE_TASK_UNAVAILABLE]:
    'This task is not available: its content type is disabled',

  [ERROR_KEYS.DOWNLOAD_TORRENT_CLIENT_ERROR]:
    'The torrent client stopped the download ({state}): check disk space and permissions',
  [ERROR_KEYS.SOURCE_SCAN_FAILED]: 'The download could not be read: {detail}',
  [ERROR_KEYS.DOWNLOAD_RETRY_REPLACED]:
    'This item was replaced by another one and cannot be resumed',
  [ERROR_KEYS.DOWNLOAD_RETRY_SUPERSEDED]:
    'Another source of this title is already being processed',
  [ERROR_KEYS.DOWNLOAD_RETRY_UNAVAILABLE]:
    'Cannot resume: the download is missing on disk',
  [ERROR_KEYS.DOWNLOAD_RETRY_ENQUEUE_FAILED]:
    'The job could not be queued again, try again',

  [ERROR_KEYS.CALENDAR_INVALID_DATE]: 'Invalid date: {value}',
  [ERROR_KEYS.CALENDAR_INVALID_RANGE]: 'Invalid calendar range',

  // class-validator DTO constraints
  [ERROR_KEYS.VALIDATION_SETTING_KEY_REQUIRED]: 'The key is required',
  [ERROR_KEYS.VALIDATION_SETTING_VALUE_REQUIRED]: 'The value is required',
  [ERROR_KEYS.VALIDATION_USER_ID_REQUIRED]: 'The user id is required',
  [ERROR_KEYS.VALIDATION_LOGIN_USERNAME_REQUIRED]: 'The username is required',
  [ERROR_KEYS.VALIDATION_LOGIN_PASSWORD_REQUIRED]: 'The password is required',
  [ERROR_KEYS.VALIDATION_USER_NAME_REQUIRED]: 'The name is required',
  [ERROR_KEYS.VALIDATION_USERNAME_MIN_LENGTH]:
    'The username must be at least 3 characters long',
  [ERROR_KEYS.VALIDATION_PASSWORD_MIN_LENGTH]:
    'The password must be at least 6 characters long',
  [ERROR_KEYS.VALIDATION_TORRENT_GROUP_NAME_REQUIRED]:
    'The torrent group name is required',
};
