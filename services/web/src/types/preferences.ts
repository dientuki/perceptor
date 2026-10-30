// Mirrors the `LanguageTrackKind`, `TorrentGroupScope`, `TorrentGroup` and
// `UserPreferences` types from api's GraphQL schema
// (docs/spec/features/021-user-preferences/spec.md § GraphQL Contract Delta).
// Hand-typed — there is no codegen across this boundary.

import type { Language } from "@/types/languages";

export type LanguageTrackKind = "AUDIO" | "SUBTITLE";

export type TorrentGroupScope = "MOVIE" | "SHOW";

export type TorrentGroup = {
  id: string;
  name: string;
};

export type UserPreferences = {
  allowCinemaReleases: boolean;
  acquireTheatrical: boolean;
  acquireDigital: boolean;
  acquirePhysical: boolean;
  audioMandatory: boolean;
  subtitleSearch: boolean;
  audioVariantDetection: boolean;
  audioLanguages: Language[];
  subtitleLanguages: Language[];
  movieTorrentGroups: TorrentGroup[];
  showTorrentGroups: TorrentGroup[];
};

export type TmdbList = {
  id: number;
  tmdbListId: number;
  name: string;
  itemCount: number | null;
  lastImportedAt: string | null;
  lastError: string | null;
};

export type TmdbListTitle = {
  id: string;
  title: string;
  overview: string | null;
  posterUrl: string | null;
  releaseDate: string | null;
  status: string;
};

export type TmdbListDetail = TmdbList & {
  movies: (TmdbListTitle & { isShort: boolean })[];
  shows: TmdbListTitle[];
};
