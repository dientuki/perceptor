// Hand-copied from api's schema.gql (spec 121); nothing checks it.

export type SubtitleProviderKind = "OPENSUBTITLES" | "SUBDIVX";

export interface SubtitleProvider {
  kind: SubtitleProviderKind;
  configured: boolean;
  isDefault: boolean;
  username: string | null;
  secretSet: boolean;
  languageTags: string[] | null;
}

export interface SubtitleProviderLanguage {
  languageTag: string;
  provider: SubtitleProviderKind;
}

export interface SubtitleProviderSettings {
  providers: SubtitleProvider[];
  languages: SubtitleProviderLanguage[];
}

export type SubtitleProviderActionResult =
  | { settings: SubtitleProviderSettings }
  | { error: string; errorKey?: string };
