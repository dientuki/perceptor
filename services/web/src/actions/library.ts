"use server";

import { cookies } from "next/headers";
import type { Movie } from "@/actions/movies";
import type { Show } from "@/actions/shows";
import { redirectToClearSession } from "@/lib/auth-session";
import { fetchGraphQL } from "@/lib/graphql-client";
import {
  LIBRARY_DISPLAY_COOKIE,
  type LibraryPossession,
  PAGE_SIZES,
  parseDisplayCookie,
  serializeDisplayCookie,
} from "@/lib/library-params";

export type LibraryPage<T> = {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type LibraryMovie = Pick<
  Movie,
  | "id"
  | "title"
  | "overview"
  | "posterUrl"
  | "releaseDate"
  | "status"
  | "isShort"
  | "fileAudioLanguages"
  | "fileSubtitleLanguages"
>;

export type LibraryShow = Pick<
  Show,
  | "id"
  | "title"
  | "overview"
  | "posterUrl"
  | "releaseDate"
  | "status"
  | "fileAudioLanguages"
  | "fileSubtitleLanguages"
>;

const MOVIE_PAGE_QUERY = `
  query GetMoviePage($isShort: Boolean, $possession: LibraryPossession!, $page: Int!, $pageSize: Int!) {
    moviePage(isShort: $isShort, possession: $possession, page: $page, pageSize: $pageSize) {
      items {
        id
        title
        overview
        posterUrl
        releaseDate
        status
        isShort
        fileAudioLanguages
        fileSubtitleLanguages
      }
      totalCount
      page
      pageSize
      totalPages
    }
  }
`;

const SHOW_PAGE_QUERY = `
  query GetShowPage($possession: LibraryPossession!, $page: Int!, $pageSize: Int!) {
    showPage(possession: $possession, page: $page, pageSize: $pageSize) {
      items {
        id
        title
        overview
        posterUrl
        releaseDate
        status
        fileAudioLanguages
        fileSubtitleLanguages
      }
      totalCount
      page
      pageSize
      totalPages
    }
  }
`;

function emptyPage<T>(pageSize: number): LibraryPage<T> {
  return { items: [], totalCount: 0, page: 1, pageSize, totalPages: 1 };
}

// Spec 117, NFR-4
export async function getMoviePage(
  isShort: boolean | undefined,
  possession: LibraryPossession,
  page: number,
  pageSize: number,
): Promise<LibraryPage<LibraryMovie>> {
  const { data, errors } = await fetchGraphQL<{
    moviePage: LibraryPage<LibraryMovie>;
  }>(MOVIE_PAGE_QUERY, { isShort, possession, page, pageSize });

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    console.error("Error al obtener películas:", errors[0]?.message);
    return emptyPage(pageSize);
  }

  return data?.moviePage ?? emptyPage(pageSize);
}

// Spec 117, NFR-4
export async function getShowPage(
  possession: LibraryPossession,
  page: number,
  pageSize: number,
): Promise<LibraryPage<LibraryShow>> {
  const { data, errors } = await fetchGraphQL<{
    showPage: LibraryPage<LibraryShow>;
  }>(SHOW_PAGE_QUERY, { possession, page, pageSize });

  if (errors && errors.length > 0) {
    redirectToClearSession(errors);
    console.error("Error al obtener series:", errors[0]?.message);
    return emptyPage(pageSize);
  }

  return data?.showPage ?? emptyPage(pageSize);
}

// Spec 117, REQ-10
export async function setLibraryDisplay(
  view: string,
  pageSize: number,
): Promise<void> {
  const size = PAGE_SIZES.find((s) => s === pageSize);
  const raw = `${view}:${size ?? ""}`;
  const display = parseDisplayCookie(raw);
  const cookieStore = await cookies();
  cookieStore.set(LIBRARY_DISPLAY_COOKIE, serializeDisplayCookie(display), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });
}
