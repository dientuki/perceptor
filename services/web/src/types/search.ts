import { MediaType } from "@/types/media";
export type MediaSearchResult = {
  id: number;
  title: string;
  releaseDate: string | null; // TMDB devuelve "" en estrenos desconocidos, el API lo mapea a null
  posterUrl: string | null;
  originalLanguage: string;
  overview?: string;
  type: MediaType; // Para saber qué icono mostrar o a qué ruta navegar
  status?: string;
  jobStatus?: string; // Nuevo campo para el estado del job asociado, si existe
};