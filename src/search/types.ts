// types.ts

export const MEDIA_TYPE = {
  MOVIE: "movie",
  TV: "tv",
} as const;

export type MediaType = (typeof MEDIA_TYPE)[keyof typeof MEDIA_TYPE];

export type MediaSearchResult = {
  id: number;
  title: string;
  releaseDate: string;
  posterUrl: string | null;
  type: MediaType; // Para saber qué icono mostrar o a qué ruta navegar
};

export interface SearchStrategy {
  execute(query: string): Promise<MediaSearchResult[]>;
}