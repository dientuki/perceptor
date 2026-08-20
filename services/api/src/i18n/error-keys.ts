/**
 * The frozen error-key vocabulary from `docs/spec/features/018-ui-i18n/spec.md`'s
 * "GraphQL Contract Delta" error tables. `api` owns every key here; `worker`'s own
 * `error.encode.*` keys live in `worker` and are not transcribed here — the two
 * exceptions are `error.processJob.not_found` and `error.source.no_download_path` /
 * `error.source.no_target`, which `worker` reuses but `api` defines and owns.
 *
 * This is the read-only vocabulary the rest of the slice keys its throw sites
 * against — do not rename or add to it without amending `spec.md` first
 * (Constitution, Article VIII).
 */
export const ERROR_KEYS = {
  // auth
  AUTH_UNAUTHENTICATED: 'error.auth.unauthenticated',
  AUTH_SESSION_EXPIRED: 'error.auth.session_expired',
  AUTH_INVALID_CREDENTIALS: 'error.auth.invalid_credentials',
  AUTH_ACCOUNT_DISABLED: 'error.auth.account_disabled',
  AUTH_ADMIN_REQUIRED: 'error.auth.admin_required',

  // users
  USER_USERNAME_TAKEN: 'error.user.username_taken',
  USER_NOT_FOUND: 'error.user.not_found',
  USER_CANNOT_DISABLE_SELF: 'error.user.cannot_disable_self',
  USER_CANNOT_DISABLE_LAST_ADMIN: 'error.user.cannot_disable_last_admin',
  USER_CANNOT_DELETE_SELF: 'error.user.cannot_delete_self',
  USER_CANNOT_DELETE_LAST_ADMIN: 'error.user.cannot_delete_last_admin',
  USER_UNSUPPORTED_LOCALE: 'error.user.unsupported_locale',

  // movies, shows, seasons, episodes
  MOVIE_NOT_FOUND: 'error.movie.not_found',
  MOVIE_NOT_IN_CATALOG: 'error.movie.not_in_catalog',
  MOVIE_DOWNLOAD_IN_PROGRESS: 'error.movie.download_in_progress',
  SHOW_NOT_AVAILABLE: 'error.show.not_available',
  SHOW_NOT_IN_CATALOG: 'error.show.not_in_catalog',
  SEASON_NOT_FOUND: 'error.season.not_found',
  SEASON_DOWNLOAD_IN_PROGRESS: 'error.season.download_in_progress',
  EPISODE_NOT_FOUND: 'error.episode.not_found',
  EPISODE_DOWNLOAD_IN_PROGRESS: 'error.episode.download_in_progress',
  MAGNET_ALREADY_ATTACHED: 'error.magnet.already_attached',
  MEDIA_UNSUPPORTED_TYPE: 'error.media.unsupported_type',

  // magnet parsing (services/api/src/clients/torrent/magnet.ts)
  MAGNET_NOT_A_MAGNET: 'error.magnet.not_a_magnet',
  MAGNET_INVALID_INFOHASH: 'error.magnet.invalid_infohash',
  MAGNET_V2_UNSUPPORTED: 'error.magnet.v2_unsupported',

  // media-roots
  MEDIA_ROOT_UNKNOWN: 'error.mediaRoot.unknown',
  MEDIA_ROOT_NOT_MOUNTED: 'error.mediaRoot.not_mounted',
  MEDIA_ROOT_INVALID_PATH: 'error.mediaRoot.invalid_path',
  MEDIA_ROOT_ABSOLUTE_PATH: 'error.mediaRoot.absolute_path',
  MEDIA_ROOT_ESCAPES_ROOT: 'error.mediaRoot.escapes_root',
  MEDIA_ROOT_FOLDER_NOT_FOUND: 'error.mediaRoot.folder_not_found',
  MEDIA_ROOT_NOT_A_FOLDER: 'error.mediaRoot.not_a_folder',

  // settings, languages, media-server, indexer
  SETTING_NOT_EDITABLE: 'error.setting.not_editable',
  SETTING_EXPECTED_BOOLEAN: 'error.setting.expected_boolean',
  SETTING_EXPECTED_INT: 'error.setting.expected_int',
  SETTING_EXPECTED_ENUM: 'error.setting.expected_enum',
  SETTING_MISSING: 'error.setting.missing',
  LANGUAGE_DUPLICATE: 'error.language.duplicate',
  LANGUAGE_UNAVAILABLE: 'error.language.unavailable',
  MEDIA_SERVER_UNKNOWN: 'error.mediaServer.unknown',
  INDEXER_UNAVAILABLE: 'error.indexer.unavailable',
  INDEXER_NO_INFOHASH: 'error.indexer.no_infohash',

  // media-sources, process-jobs, downloads
  SOURCE_NOT_FOUND: 'error.source.not_found',
  SOURCE_NO_TARGET: 'error.source.no_target',
  SOURCE_MATCH_NOT_REPORTED: 'error.source.match_not_reported',
  SOURCE_SCAN_NO_VIDEO: 'error.source.scan_no_video',
  SOURCE_NO_DOWNLOAD_PATH: 'error.source.no_download_path',
  SOURCE_REPLACED: 'error.source.replaced',
  PROCESS_JOB_NOT_FOUND: 'error.processJob.not_found',

  // uploads — GraphQL
  UPLOAD_TARGET_AMBIGUOUS: 'error.upload.target_ambiguous',

  // uploads — REST (`UploadHttpError`, services/api/src/uploads/uploads.service.ts)
  UPLOAD_TICKET_EXPIRED: 'error.upload.ticket_expired',
  UPLOAD_TICKET_WRONG_MOVIE: 'error.upload.ticket_wrong_movie',
  UPLOAD_TICKET_WRONG_EPISODE: 'error.upload.ticket_wrong_episode',
  UPLOAD_METADATA_INCOMPLETE: 'error.upload.metadata_incomplete',

  // class-validator DTO constraints (018 REQ-9). Not part of `spec.md`'s error
  // tables — spec.md doesn't name these eight, so the keys are named here,
  // consistently with the rest of the vocabulary. `main.ts`'s
  // `ValidationPipe.exceptionFactory` uses the `message` option's value on
  // each decorator (below) as the key itself and renders it through
  // `MESSAGES_EN`.
  VALIDATION_SETTING_KEY_REQUIRED: 'error.validation.setting_key_required',
  VALIDATION_SETTING_VALUE_REQUIRED: 'error.validation.setting_value_required',
  VALIDATION_USER_ID_REQUIRED: 'error.validation.user_id_required',
  VALIDATION_LOGIN_USERNAME_REQUIRED: 'error.validation.login_username_required',
  VALIDATION_LOGIN_PASSWORD_REQUIRED: 'error.validation.login_password_required',
  VALIDATION_USER_NAME_REQUIRED: 'error.validation.user_name_required',
  VALIDATION_USERNAME_MIN_LENGTH: 'error.validation.username_min_length',
  VALIDATION_PASSWORD_MIN_LENGTH: 'error.validation.password_min_length',
} as const;

export type ErrorKey = (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS];
