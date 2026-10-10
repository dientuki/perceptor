import { MediaType } from "@/types/media";
export type MediaSearchResult = {
  id: number;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  originalLanguage: string;
  overview?: string;
  type: MediaType;
  status?: string;
  jobStatus?: string;
  mediaId: number | null; // the id of the registered row in whatever table `type` names
  inLibrary: boolean; // true only when the calling user already has this film
  isShort: boolean; // false for anything not registered as a short (or for a series)
};
