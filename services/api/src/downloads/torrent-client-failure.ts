import { HttpException } from '@nestjs/common';
import { TorrentClientError } from '@/clients/torrent/client';
import { ERROR_KEYS } from '@/i18n/error-keys';
import { i18nError } from '@/i18n/i18n-error';

function isCredentialRejection(err: unknown): boolean {
  return err instanceof TorrentClientError && (err.status === 401 || err.status === 403);
}

// Spec 104, REQ-5
export function torrentClientFailure(err: unknown): HttpException {
  if (isCredentialRejection(err)) {
    return i18nError.serviceUnavailable(ERROR_KEYS.TORRENT_CLIENT_UNAUTHORIZED);
  }
  const status = err instanceof TorrentClientError ? err.status : 0;
  return i18nError.serviceUnavailable(ERROR_KEYS.TORRENT_CLIENT_REJECTED, { status });
}

// Spec 104, REQ-5
export function describeTorrentClientFailure(err: unknown): string {
  if (isCredentialRejection(err)) {
    return `credential rejected (HTTP ${(err as TorrentClientError).status}): check TORRENT_API_KEY`;
  }
  return err instanceof Error ? err.message : String(err);
}
