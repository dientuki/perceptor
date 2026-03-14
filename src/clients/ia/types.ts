export const IA_CLIENTS = {
  GEMINI: "gemini"
} as const;

export type IAClientType =
  (typeof IA_CLIENTS)[keyof typeof IA_CLIENTS];

export type IAClient = {
  buildSearchParams: (input: string) => Promise<SearchParams>;
  buildMediaList: (input: string, json: string) => Promise<any[]>;
  translate: (texts: string[]) => Promise<string[]>;
};

export type SearchParams = {
  type: string;
  query: string;
};