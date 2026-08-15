"use server";

import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";

export interface Episode {
  id: string;
  episodeNumber: number;
  title?: string;
  overview?: string;
  releaseDate?: string;
  status: string;
}

export interface Season {
  id: string;
  seasonNumber: number;
  releaseDate?: string;
  episodes: Episode[];
}

export interface Show {
  id: string;
  tmdbId: number;
  title: string;
  overview?: string;
  posterUrl?: string;
  releaseDate?: string;
  originalLanguage: string;
  isLiveAction: boolean;
  status: string;
  seasonsSyncedAt?: string;
  // Only present when fetched via getShowById — getShows() doesn't request it
  seasons?: Season[];
}

const GET_SHOWS_QUERY = `
  query GetStoredShows {
    shows {
      id
      overview
      title
      posterUrl
      releaseDate
    }
  }
`;

export async function getShows(): Promise<Show[]> {
  const { data, errors } = await fetchGraphQL<{ shows: Show[] }>(
    GET_SHOWS_QUERY,
  );

  // GraphQL answers 200 with `errors` populated: without this check `data` is undefined
  if (errors && errors.length > 0) {
    // Called directly from ShowsPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead of
    // redirectIfUnauthenticated (which throws by mutating cookies).
    redirectToClearSession(errors);
    // Any other error: log it server-side and fall back to an empty list,
    // matching what the client component's try/catch used to do silently —
    // there is no app/(dashboard)/error.tsx, so letting this throw would
    // surface Next's default error screen instead of the empty state.
    console.error("Error al obtener series:", errors[0]?.message);
    return [];
  }

  return data?.shows ?? [];
}

const GET_SHOW_QUERY = `
  query GetShow($id: Int!) {
    show(id: $id) {
      id
      tmdbId
      title
      overview
      posterUrl
      releaseDate
      originalLanguage
      isLiveAction
      status
      seasonsSyncedAt
      seasons {
        id
        seasonNumber
        releaseDate
        episodes {
          id
          episodeNumber
          title
          overview
          releaseDate
          status
        }
      }
    }
  }
`;

export async function getShowById(id: number): Promise<Show | null> {
  const { data, errors } = await fetchGraphQL<{ show: Show | null }>(
    GET_SHOW_QUERY,
    { id },
  );

  if (errors && errors.length > 0) {
    // Called directly from ShowDetailsPage's Server Component render (and
    // its generateMetadata) — cookie mutation is illegal there, so hand off
    // to the Route Handler instead of mutating the cookie in-process.
    redirectToClearSession(errors);
    throw new Error(errors[0]?.message || "Error al obtener la serie");
  }

  // El API devuelve null cuando el id no existe o no pertenece al usuario;
  // la página lo traduce a notFound()
  return data?.show ?? null;
}

const ADD_TORRENT_TO_EPISODE_MUTATION = `
  mutation AddTorrentToEpisode($episodeId: Int!, $infoHash: String!, $urls: [String!]!, $releaseTitle: String, $force: Boolean) {
    addTorrentToEpisode(episodeId: $episodeId, infoHash: $infoHash, urls: $urls, releaseTitle: $releaseTitle, force: $force) {
      id
      status
    }
  }
`;

export async function addTorrentToEpisodeAction(
  episodeId: number,
  infoHash: string,
  urls: string[],
  releaseTitle: string | null,
  force = false,
): Promise<{ id: number; status: string }> {
  const { data, errors } = await fetchGraphQL<{
    addTorrentToEpisode: { id: number; status: string };
  }>(ADD_TORRENT_TO_EPISODE_MUTATION, {
    episodeId,
    infoHash,
    urls,
    releaseTitle,
    force,
  });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(errors[0]?.message || "Error al agregar el torrent");
  }

  return data!.addTorrentToEpisode;
}

const ADD_MAGNET_TO_EPISODE_MUTATION = `
  mutation AddMagnetToEpisode($episodeId: Int!, $magnet: String!, $force: Boolean) {
    addMagnetToEpisode(episodeId: $episodeId, magnet: $magnet, force: $force) {
      id
      status
    }
  }
`;

export async function addMagnetToEpisodeAction(
  episodeId: number,
  magnet: string,
  force = false,
): Promise<{ id: number; status: string }> {
  const { data, errors } = await fetchGraphQL<{
    addMagnetToEpisode: { id: number; status: string };
  }>(ADD_MAGNET_TO_EPISODE_MUTATION, { episodeId, magnet, force });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(errors[0]?.message || "Error al importar el magnet");
  }

  return data!.addMagnetToEpisode;
}
