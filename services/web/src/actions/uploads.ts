"use server";

import { getTranslations } from "next-intl/server";
import { redirectIfUnauthenticated } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { toActionError } from "@/lib/graphql-error";
import { withRequestScheme } from "@/lib/request-scheme";
import type { SingleFileAcquisitionTarget } from "@/types/media";

export interface UploadTicket {
  token: string;
  expiresAt: string;
  // Filled in by this server action from `PUBLIC_UPLOAD_URL`, not by the
  // mutation below — do not go looking for it in `schema.gql`.
  endpoint: string;
}

export type CreateUploadTicketResult =
  | { success: true; ticket: UploadTicket }
  | { error: string; errorKey?: string };

// Spec 027, REQ-7
const CREATE_UPLOAD_TICKET_MUTATION = `
  mutation CreateUploadTicket($movieId: Int, $episodeId: Int, $force: Boolean) {
    createUploadTicket(movieId: $movieId, episodeId: $episodeId, force: $force) {
      token
      expiresAt
    }
  }
`;

export async function createUploadTicketAction(
  target: SingleFileAcquisitionTarget,
  force = false,
): Promise<CreateUploadTicketResult> {
  const variables =
    target.kind === "movie"
      ? { movieId: Number(target.movie.id), episodeId: undefined, force }
      : { movieId: undefined, episodeId: Number(target.episode.id), force };

  const { data, errors } = await fetchGraphQL<{
    createUploadTicket: Omit<UploadTicket, "endpoint">;
  }>(CREATE_UPLOAD_TICKET_MUTATION, variables);

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  if (!data?.createUploadTicket) {
    const t = await getTranslations("errors");
    return { error: t("upload.ticketMissing") };
  }

  const endpoint = process.env.PUBLIC_UPLOAD_URL;
  if (!endpoint) {
    const t = await getTranslations("errors");
    return { error: t("upload.endpointNotConfigured") };
  }

  return {
    success: true,
    ticket: {
      ...data.createUploadTicket,
      endpoint: await withRequestScheme(endpoint),
    },
  };
}

export type StartSeasonUploadResult =
  | { success: true; mediaSourceId: number; seasonId: number }
  | { error: string; errorKey?: string };

const START_SEASON_UPLOAD_MUTATION = `
  mutation StartSeasonUpload($seasonId: Int!, $force: Boolean) {
    startSeasonUpload(seasonId: $seasonId, force: $force) {
      mediaSourceId
      seasonId
    }
  }
`;

export async function startSeasonUploadAction(
  seasonId: number,
  force = false,
): Promise<StartSeasonUploadResult> {
  const { data, errors } = await fetchGraphQL<{
    startSeasonUpload: { mediaSourceId: number; seasonId: number };
  }>(START_SEASON_UPLOAD_MUTATION, { seasonId, force });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  if (!data?.startSeasonUpload) {
    const t = await getTranslations("errors");
    return { error: t("upload.ticketMissing") };
  }

  return { success: true, ...data.startSeasonUpload };
}

const CREATE_SEASON_UPLOAD_TICKET_MUTATION = `
  mutation CreateSeasonUploadTicket($mediaSourceId: Int!) {
    createSeasonUploadTicket(mediaSourceId: $mediaSourceId) {
      token
      expiresAt
    }
  }
`;

export async function createSeasonUploadTicketAction(
  mediaSourceId: number,
): Promise<CreateUploadTicketResult> {
  const { data, errors } = await fetchGraphQL<{
    createSeasonUploadTicket: Omit<UploadTicket, "endpoint">;
  }>(CREATE_SEASON_UPLOAD_TICKET_MUTATION, { mediaSourceId });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  if (!data?.createSeasonUploadTicket) {
    const t = await getTranslations("errors");
    return { error: t("upload.ticketMissing") };
  }

  const endpoint = process.env.PUBLIC_UPLOAD_URL;
  if (!endpoint) {
    const t = await getTranslations("errors");
    return { error: t("upload.endpointNotConfigured") };
  }

  return {
    success: true,
    ticket: {
      ...data.createSeasonUploadTicket,
      endpoint: await withRequestScheme(endpoint),
    },
  };
}

export type FinishSeasonUploadResult =
  | { success: true }
  | { error: string; errorKey?: string };

const FINISH_SEASON_UPLOAD_MUTATION = `
  mutation FinishSeasonUpload($mediaSourceId: Int!) {
    finishSeasonUpload(mediaSourceId: $mediaSourceId) {
      id
    }
  }
`;

export async function finishSeasonUploadAction(
  mediaSourceId: number,
): Promise<FinishSeasonUploadResult> {
  const { data, errors } = await fetchGraphQL<{
    finishSeasonUpload: { id: number };
  }>(FINISH_SEASON_UPLOAD_MUTATION, { mediaSourceId });

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  if (!data?.finishSeasonUpload) {
    const t = await getTranslations("errors");
    return { error: t("upload.ticketMissing") };
  }

  return { success: true };
}
