"use client";

import { useState, useEffect } from "react";
import type { Movie, Episode } from "@prisma/client";
import { MediaType } from "@prisma/client";
import { Search, Download, Loader2, Database } from "lucide-react";
import { TorrentResult } from "@/clients/indexer/types"; // Import TorrentResult
import Button from "@/components/ui/button/Button";
import { logger } from "@/lib/logger";
import { searchTorrentsAction, addTorrentToQueueAction } from "@/actions/indexer";

interface SearchTorrentProps {
  item: Movie | Episode;
  mediaType: MediaType;
  showTitle?: string;
  seasonNumber?: number;
  onClose: () => void;
}

export default function SearchTorrent({ item, mediaType, showTitle, seasonNumber, onClose }: SearchTorrentProps) {

  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "N/A";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TorrentResult[]>([]);
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (mediaType === MediaType.MOVIE) {
      setQuery((item as Movie).title);
    } else {
      const ep = item as Episode;
      // Limpiar caracteres raros del nombre de la serie
      const cleanShowTitle = (showTitle || "")
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      
      const s = String(seasonNumber ?? 0).padStart(2, "0");
      const e = String(ep.episodeNumber ?? 0).padStart(2, "0");
      setQuery(`${cleanShowTitle} S${s}E${e}`.trim());
    }
  }, [item, mediaType, showTitle, seasonNumber]);

  const filteredResults = results.filter((res) =>
    (res.title || "").toLowerCase().includes(filter.toLowerCase())
  );

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    try {
      const data = await searchTorrentsAction(query);
      setResults(data);
    } catch (error) {
      logger.error({ error, query }, "Error al buscar torrents");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTorrent = async (res: TorrentResult) => {
    const urls = res.items
      .map((i) => i.downloadUrl)
      .filter((url): url is string => !!url);

    let tmdbId: number | undefined;

    if (mediaType === MediaType.MOVIE) {
      tmdbId = (item as Movie).tmdbId ?? undefined;
    }

    try {
      const result = await addTorrentToQueueAction({ id: item.id, tmdbId, infoHash: res.infoHash }, urls, mediaType);
      if (!result.success) {
        logger.error({ message: result.message }, "Fallo al añadir torrent a la cola"); // TODO: Reemplazar con notificación Toast
      } else {
        // Opcional: Mostrar notificación de éxito
        onClose();
      }
    } catch (error) {
      logger.error({ error, item, urls, mediaType }, "Error adding torrent to queue"); // TODO: Reemplazar con notificación Toast
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 space-y-6 overflow-hidden">

      <form onSubmit={handleSearch} className="flex flex-shrink-0 gap-3">
        <div className="relative flex-1 ">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for releases..."
            className="w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-800 dark:text-white"
          />
        </div>
        <Button type="submit" disabled={isLoading} className="min-w-[100px]">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {results.length > 0 && (
        <div className="relative flex-shrink-0">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter results by title (e.g. 1080p, x265)..."
            className="w-full rounded-lg border border-gray-200 bg-transparent py-2 pl-10 pr-4 text-sm outline-none transition focus:border-blue-500 dark:border-gray-800 dark:text-white"
          />
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden">
        <table className="flex flex-col h-full w-full divide-y divide-gray-200 dark:divide-gray-800">
          <thead className="flex-shrink-0 bg-gray-50 dark:bg-white/[0.02]">
            <tr className="grid grid-cols-[minmax(0,1fr)_100px_100px_80px] items-center w-full">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Release Name ({filteredResults.length})</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">Size</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">S/L</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Action</th>
            </tr>
          </thead>
          <tbody className="flex-1 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-800 custom-scrollbar [scrollbar-gutter:stable]">
            {filteredResults.length > 0 ? (
              filteredResults.map((res) => (
                <tr key={res.infoHash} className="grid grid-cols-[minmax(0,1fr)_100px_100px_80px] items-center hover:bg-gray-50 dark:hover:bg-white/[0.01]">
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium line-clamp-1">{res.title || "Unknown Release"}</span>
                    <div className="mt-1 flex flex-col gap-0.5 overflow-hidden">
                      {res.infoUrl.map((indexerItem, idx) => indexerItem.downloadUrl && (
                        <a
                          key={idx}
                          href={indexerItem.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-500 hover:underline dark:text-blue-400 line-clamp-1"
                        >
                          {indexerItem.downloadUrl}
                        </a>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatBytes(res.size)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <span className="text-green-500">{res.seeders}</span> / <span className="text-gray-400">{res.leechers}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleAddTorrent(res)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr className="flex w-full">
                <td className="flex-1 px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                  {isLoading 
                    ? "Searching trackers..." 
                    : results.length > 0 
                      ? "No results match your filter." 
                      : "No results yet. Try searching for a specific release."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}