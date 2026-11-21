"use server";

import {
  redirectIfUnauthenticated,
  redirectToClearSession,
} from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import { toActionError } from "@/lib/graphql-error";
import type { LibraryTagMigration } from "@/types/library-tags";

const LIBRARY_TAG_MIGRATION_FIELDS = `
  id
  status
  total
  processed
  migrated
  unchanged
  busy
  missing
  failed
  failures {
    path
    reasonKey
  }
  startedAt
  finishedAt
`;

const LIBRARY_TAG_MIGRATION_QUERY = `
  query LibraryTagMigration {
    libraryTagMigration {
      ${LIBRARY_TAG_MIGRATION_FIELDS}
    }
  }
`;

const START_LIBRARY_TAG_MIGRATION_MUTATION = `
  mutation StartLibraryTagMigration {
    startLibraryTagMigration {
      ${LIBRARY_TAG_MIGRATION_FIELDS}
    }
  }
`;

// Spec 123, REQ-18
export async function getLibraryTagMigration(): Promise<LibraryTagMigration | null> {
  const { data, errors } = await fetchGraphQL<{
    libraryTagMigration: LibraryTagMigration | null;
  }>(LIBRARY_TAG_MIGRATION_QUERY);

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    console.error(
      errors[0]?.message || "Error al obtener la migración de etiquetas",
    );
    return null;
  }

  return data?.libraryTagMigration ?? null;
}

export type StartLibraryTagMigrationActionResult =
  | { migration: LibraryTagMigration }
  | { error: string; errorKey?: string };

// Spec 123, REQ-12
export async function startLibraryTagMigrationAction(): Promise<StartLibraryTagMigrationActionResult> {
  const { data, errors } = await fetchGraphQL<{
    startLibraryTagMigration: LibraryTagMigration;
  }>(START_LIBRARY_TAG_MIGRATION_MUTATION);

  if (errors && errors.length > 0) {
    await redirectIfUnauthenticated(errors);
    return await toActionError(errors[0]);
  }

  if (!data) {
    return { error: "Error al iniciar la migración de etiquetas" };
  }

  return { migration: data.startLibraryTagMigration };
}
