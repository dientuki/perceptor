// types.ts
import { MediaType } from "@/types/media";

export type MediaSearchResult = {
  id: number;
  title: string;
  releaseDate: string;
  posterUrl: string | null;
  originalLanguage: string;
  overview?: string;
  type: MediaType; // Para saber qué icono mostrar o a qué ruta navegar
  status?: string;
  showLink?: boolean;
  jobStatus?: string; // Nuevo campo para el estado del job asociado, si existe
};

export interface SearchStrategy {
  execute(query: string): Promise<MediaSearchResult[]>;
}