"use server";

import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { toActionError } from "@/lib/graphql-error";
import type { Download } from "@/types/downloads";

const DOWNLOAD_FIELDS = `
  mediaSourceId
  infoHash
  kind
  label
  releaseTitle
  movieId
  seasonId
  episodeId
  status
  torrentState
  downloadProgress
  encodeProgress
  compressionEnabled
  downloadSpeed
  readAt
`;

const MOVIE_DOWNLOADS_QUERY = `
  query MovieDownloads($movieId: Int!) {
    movieDownloads(movieId: $movieId) {
      ${DOWNLOAD_FIELDS}
    }
  }
`;

const SHOW_DOWNLOADS_QUERY = `
  query ShowDownloads($showId: Int!) {
    showDownloads(showId: $showId) {
      ${DOWNLOAD_FIELDS}
    }
  }
`;

const DOWNLOAD_START_MUTATION = `
  mutation DownloadStart($mediaSourceId: Int!) {
    downloadStart(mediaSourceId: $mediaSourceId) {
      ${DOWNLOAD_FIELDS}
    }
  }
`;

const DOWNLOAD_STOP_MUTATION = `
  mutation DownloadStop($mediaSourceId: Int!) {
    downloadStop(mediaSourceId: $mediaSourceId) {
      ${DOWNLOAD_FIELDS}
    }
  }
`;

const DOWNLOAD_DELETE_MUTATION = `
  mutation DownloadDelete($mediaSourceId: Int!) {
    downloadDelete(mediaSourceId: $mediaSourceId)
  }
`;

// Called from a Server Component render pass (the movie/show detail pages),
// so it uses redirectToClearSession — cookie mutation is illegal there.
//
// Unlike getMovieById, movieDownloads throws MOVIE_NOT_FOUND for a missing
// or unowned title rather than answering with an empty/null result (see the
// GraphQL Contract Delta's error table). The page already renders notFound()
// off getMovieById's null, called in the same Promise.all — swallowing a
// non-auth error here and falling back to [] (as getMovies() already does)
// avoids that same condition surfacing a second time as an uncaught 500
// racing the real notFound() check.
export async function getMovieDownloads(movieId: number): Promise<Download[]> {
  const { data, errors } = await fetchGraphQL<{ movieDownloads: Download[] }>(
    MOVIE_DOWNLOADS_QUERY,
    { movieId },
  );

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    console.error("Failed to fetch movie downloads:", errors[0]?.message);
    return [];
  }

  return data?.movieDownloads ?? [];
}

export async function getShowDownloads(showId: number): Promise<Download[]> {
  const { data, errors } = await fetchGraphQL<{ showDownloads: Download[] }>(
    SHOW_DOWNLOADS_QUERY,
    { showId },
  );

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    console.error("Failed to fetch show downloads:", errors[0]?.message);
    return [];
  }

  return data?.showDownloads ?? [];
}

export type DownloadActionResult =
  | { success: true; download: Download }
  | { error: string; errorKey?: string };

// Called from the panel, a client component, so it uses
// redirectIfUnauthenticated, like every other form action.
export async function startDownloadAction(
  mediaSourceId: number,
): Promise<DownloadActionResult> {
  const { data, errors } = await fetchGraphQL<{ downloadStart: Download }>(
    DOWNLOAD_START_MUTATION,
    { mediaSourceId },
  );

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  return { success: true, download: data!.downloadStart };
}

export async function stopDownloadAction(
  mediaSourceId: number,
): Promise<DownloadActionResult> {
  const { data, errors } = await fetchGraphQL<{ downloadStop: Download }>(
    DOWNLOAD_STOP_MUTATION,
    { mediaSourceId },
  );

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  return { success: true, download: data!.downloadStop };
}

export type DeleteDownloadActionResult =
  | { success: true }
  | { error: string; errorKey?: string };

export async function deleteDownloadAction(
  mediaSourceId: number,
): Promise<DeleteDownloadActionResult> {
  const { data, errors } = await fetchGraphQL<{ downloadDelete: boolean }>(
    DOWNLOAD_DELETE_MUTATION,
    { mediaSourceId },
  );

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  if (!data?.downloadDelete) {
    return { error: "No se pudo borrar la descarga." };
  }

  return { success: true };
}
