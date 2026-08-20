"use server";

import { getTranslations } from "next-intl/server";
import { redirectIfUnauthenticated } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { translateGraphQLError } from "@/lib/graphql-error";
import type { AcquisitionTarget } from "@/types/media";

export interface UploadTicket {
  token: string;
  expiresAt: string;
  // Filled in by this server action from `PUBLIC_UPLOAD_URL`, not by the
  // mutation below — do not go looking for it in `schema.gql`.
  endpoint: string;
}

// CHANGED: both arguments are now nullable on the API side — exactly one must
// be supplied. Sent by name below, never positionally, since a bare
// positional id is how a film upload could silently mint a ticket for
// `undefined` once `movieId` stopped being required.
const CREATE_UPLOAD_TICKET_MUTATION = `
  mutation CreateUploadTicket($movieId: Int, $episodeId: Int) {
    createUploadTicket(movieId: $movieId, episodeId: $episodeId) {
      token
      expiresAt
    }
  }
`;

export async function createUploadTicketAction(
  target: AcquisitionTarget,
): Promise<UploadTicket> {
  const variables =
    target.kind === "movie"
      ? { movieId: Number(target.movie.id), episodeId: undefined }
      : { movieId: undefined, episodeId: Number(target.episode.id) };

  const { data, errors } = await fetchGraphQL<{
    createUploadTicket: Omit<UploadTicket, "endpoint">;
  }>(CREATE_UPLOAD_TICKET_MUTATION, variables);

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  if (!data?.createUploadTicket) {
    const t = await getTranslations("errors");
    throw new Error(t("upload.ticketMissing"));
  }

  const endpoint = process.env.PUBLIC_UPLOAD_URL;
  if (!endpoint) {
    const t = await getTranslations("errors");
    throw new Error(t("upload.endpointNotConfigured"));
  }

  return { ...data.createUploadTicket, endpoint };
}
