"use server";

import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { toActionError, translateGraphQLError } from "@/lib/graphql-error";
import type {
  MediaServerIndexStatus,
  MediaServerOption,
} from "@/types/media-server";

const MEDIA_SERVER_CLIENTS_QUERY = `
  query MediaServerClients {
    mediaServerClients {
      id
      label
    }
  }
`;

const MEDIA_SERVER_INDEX_STATUS_QUERY = `
  query MediaServerIndexStatus {
    mediaServerIndexStatus {
      state
      itemCount
      syncedAt
    }
  }
`;

const RESYNC_MEDIA_SERVER_INDEX_MUTATION = `
  mutation ResyncMediaServerIndex {
    resyncMediaServerIndex {
      state
      itemCount
      syncedAt
    }
  }
`;

export async function getMediaServerOptions(): Promise<MediaServerOption[]> {
  const { data, errors } = await fetchGraphQL<{
    mediaServerClients: MediaServerOption[];
  }>(MEDIA_SERVER_CLIENTS_QUERY);

  if (errors && errors.length > 0) {
    // Called directly from SettingsPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead.
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return data?.mediaServerClients ?? [];
}

// Same render-pass constraint as getMediaServerOptions above.
export async function getMediaServerIndexStatus(): Promise<MediaServerIndexStatus> {
  const { data, errors } = await fetchGraphQL<{
    mediaServerIndexStatus: MediaServerIndexStatus;
  }>(MEDIA_SERVER_INDEX_STATUS_QUERY);

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return (
    data?.mediaServerIndexStatus ?? {
      state: "never",
      itemCount: 0,
      syncedAt: null,
    }
  );
}

export type ResyncMediaServerIndexActionResult =
  | { status: MediaServerIndexStatus }
  | { error: string; errorKey?: string };

// Called from the Re-sync button, a client component — not a
// useActionState form action (it takes no FormData and isn't wired to a
// <form>), just a plain server function invoked from a click handler.
export async function resyncMediaServerIndexAction(): Promise<ResyncMediaServerIndexActionResult> {
  const { data, errors } = await fetchGraphQL<{
    resyncMediaServerIndex: MediaServerIndexStatus;
  }>(RESYNC_MEDIA_SERVER_INDEX_MUTATION);

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  return { status: data!.resyncMediaServerIndex };
}
