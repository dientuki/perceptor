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
  [ERROR_KEYS.AUTH_ADMIN_REQUIRED]: 'You do not have permission to manage users',

  // users
  [ERROR_KEYS.USER_USERNAME_TAKEN]: 'That username is already registered',
  [ERROR_KEYS.USER_NOT_FOUND]: 'User "{id}" not found',
  [ERROR_KEYS.USER_CANNOT_DISABLE_SELF]: 'You cannot disable your own user',
  [ERROR_KEYS.USER_CANNOT_DISABLE_LAST_ADMIN]: 'You cannot disable the only administrator',
  [ERROR_KEYS.USER_CANNOT_DELETE_SELF]: 'You cannot delete your own user',
  [ERROR_KEYS.USER_CANNOT_DELETE_LAST_ADMIN]: 'You cannot delete the only administrator',
  [ERROR_KEYS.USER_UNSUPPORTED_LOCALE]: 'Locale "{locale}" is not supported',

  // movies, shows, seasons, episodes
  [ERROR_KEYS.MOVIE_NOT_FOUND]: 'Movie {id} does not exist',
  [ERROR_KEYS.MOVIE_NOT_IN_CATALOG]: 'We could not find that movie in the catalog',
  [ERROR_KEYS.MOVIE_DOWNLOAD_IN_PROGRESS]:
    'This movie already has a download in progress. Confirm to replace it.',
  [ERROR_KEYS.SHOW_NOT_AVAILABLE]: 'Resource not available for this user',
  [ERROR_KEYS.SHOW_NOT_IN_CATALOG]: 'We could not find that series in the catalog',
  [ERROR_KEYS.SEASON_NOT_FOUND]: 'Season {id} does not exist',
  [ERROR_KEYS.SEASON_DOWNLOAD_IN_PROGRESS]:
    'This season already has a download in progress. Confirm to replace it.',
  [ERROR_KEYS.EPISODE_NOT_FOUND]: 'Episode {id} does not exist',
  [ERROR_KEYS.EPISODE_DOWNLOAD_IN_PROGRESS]:
    'This episode already has a download in progress. Confirm to replace it.',
  [ERROR_KEYS.MAGNET_ALREADY_ATTACHED]: 'That magnet is already attached to «{title}»',
  [ERROR_KEYS.MEDIA_UNSUPPORTED_TYPE]: 'Unsupported media type: {type}',

  // magnet parsing
  [ERROR_KEYS.MAGNET_NOT_A_MAGNET]: 'That does not look like a magnet link',
  [ERROR_KEYS.MAGNET_INVALID_INFOHASH]: 'The magnet has no valid infoHash',
  [ERROR_KEYS.MAGNET_V2_UNSUPPORTED]: 'BitTorrent v2 magnets are not supported yet',

  // media-roots
  [ERROR_KEYS.MEDIA_ROOT_UNKNOWN]: 'Unknown media root: "{rootId}"',
  [ERROR_KEYS.MEDIA_ROOT_NOT_MOUNTED]:
    'Root "{label}" is not mounted in this container — check {envVar} in your .env and bring the stack back up',
  [ERROR_KEYS.MEDIA_ROOT_INVALID_PATH]: 'Invalid path',
  [ERROR_KEYS.MEDIA_ROOT_ABSOLUTE_PATH]: 'The path for "{label}" must be relative to {hostPath}, not absolute',
  [ERROR_KEYS.MEDIA_ROOT_ESCAPES_ROOT]: 'The path escapes "{label}" ({hostPath})',
  [ERROR_KEYS.MEDIA_ROOT_FOLDER_NOT_FOUND]: 'Folder "{path}" does not exist in "{label}"',
  [ERROR_KEYS.MEDIA_ROOT_NOT_A_FOLDER]: '"{path}" is not a folder',

  // settings, languages, media-server, indexer
  [ERROR_KEYS.SETTING_NOT_EDITABLE]: 'Unknown or read-only setting: "{key}"',
  [ERROR_KEYS.SETTING_EXPECTED_BOOLEAN]: '"{key}" must be "true" or "false"',
  [ERROR_KEYS.SETTING_EXPECTED_INT]: '"{key}" must be a number',
  [ERROR_KEYS.SETTING_EXPECTED_ENUM]: '"{key}" must be one of: {options}',
  [ERROR_KEYS.SETTING_MISSING]: 'Setting "{key}" is missing — configure it in Settings before encoding',
  [ERROR_KEYS.LANGUAGE_DUPLICATE]: 'Language {iso2} is repeated',
  [ERROR_KEYS.LANGUAGE_UNAVAILABLE]: 'Language {iso2} is not available',
  [ERROR_KEYS.MEDIA_SERVER_UNKNOWN]: 'Unknown media server: "{id}"',
  [ERROR_KEYS.INDEXER_UNAVAILABLE]: 'Could not reach the indexer',
  [ERROR_KEYS.INDEXER_NO_INFOHASH]: 'Could not resolve an infoHash',

  // media-sources, process-jobs, downloads
  [ERROR_KEYS.SOURCE_NOT_FOUND]: 'Media source {id} does not exist',
  [ERROR_KEYS.SOURCE_NO_TARGET]: 'Media source {id} points at no movie, episode or season',
  [ERROR_KEYS.SOURCE_MATCH_NOT_REPORTED]: 'matchedFilePath {filePath} is not in the reported file list',
  [ERROR_KEYS.SOURCE_SCAN_NO_VIDEO]: 'Scan found no main video file: empty folder or no video',
  [ERROR_KEYS.SOURCE_NO_DOWNLOAD_PATH]: 'Completed with no download path recorded — cannot enqueue',
  [ERROR_KEYS.SOURCE_REPLACED]: 'Replaced by a new download',
  [ERROR_KEYS.PROCESS_JOB_NOT_FOUND]: 'Process job {id} does not exist',

  // uploads — GraphQL
  [ERROR_KEYS.UPLOAD_TARGET_AMBIGUOUS]: 'Provide exactly one of movieId or episodeId',

  // uploads — REST
  [ERROR_KEYS.UPLOAD_TICKET_EXPIRED]: 'The upload ticket expired, try again',
  [ERROR_KEYS.UPLOAD_TICKET_WRONG_MOVIE]: 'The upload ticket does not belong to this movie',
  [ERROR_KEYS.UPLOAD_TICKET_WRONG_EPISODE]: 'The upload ticket does not belong to this episode',
  [ERROR_KEYS.UPLOAD_METADATA_INCOMPLETE]: 'Upload metadata is incomplete',

  // class-validator DTO constraints
  [ERROR_KEYS.VALIDATION_SETTING_KEY_REQUIRED]: 'The key is required',
  [ERROR_KEYS.VALIDATION_SETTING_VALUE_REQUIRED]: 'The value is required',
  [ERROR_KEYS.VALIDATION_USER_ID_REQUIRED]: 'The user id is required',
  [ERROR_KEYS.VALIDATION_LOGIN_USERNAME_REQUIRED]: 'The username is required',
  [ERROR_KEYS.VALIDATION_LOGIN_PASSWORD_REQUIRED]: 'The password is required',
  [ERROR_KEYS.VALIDATION_USER_NAME_REQUIRED]: 'The name is required',
  [ERROR_KEYS.VALIDATION_USERNAME_MIN_LENGTH]: 'The username must be at least 3 characters long',
  [ERROR_KEYS.VALIDATION_PASSWORD_MIN_LENGTH]: 'The password must be at least 6 characters long',
};
