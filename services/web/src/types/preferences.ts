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
  audioMandatory: boolean;
  audioLanguages: Language[];
  subtitleLanguages: Language[];
  movieTorrentGroups: TorrentGroup[];
  showTorrentGroups: TorrentGroup[];
};
