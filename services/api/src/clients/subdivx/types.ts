// Spec 121, REQ-10
export type SubdivxSearchParams = {
  imdbId?: string;
  title?: string;
  year?: number;
  query?: string;
};

export type SubdivxItem = {
  id: number | string;
  title?: string | null;
  description?: string | null;
  season?: number | null;
  episode?: number | null;
  downloads?: number | null;
};

export type SubdivxSearchResponse = {
  items?: SubdivxItem[];
  total?: number;
};

export type SubdivxDownload = { bytes: Buffer; fileName: string | null };
