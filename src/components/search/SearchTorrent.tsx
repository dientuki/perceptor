"use client";

import { useState } from "react";
import type { Movie, Episode } from "@prisma/client";
import { MediaType } from "@prisma/client";
import { Search, Download, Loader2, Database } from "lucide-react";
import { TorrentResult } from "@/clients/indexer/types"; // Import TorrentResult
import Button from "@/components/ui/button/Button";
import { logger } from "@/lib/logger";
import { searchTorrentsAction } from "@/actions/indexer";

interface SearchTorrentProps {
  item: Movie | Episode;
  mediaType: MediaType;
}

export default function SearchTorrent({ item, mediaType }: SearchTorrentProps) {
  // Lógica para obtener el título inicial
  const getInitialQuery = () => {
    if (mediaType === MediaType.MOVIE) {
      return (item as Movie).title;
    }
    const ep = item as Episode;
    return ep.title || `Episode ${ep.episodeNumber}`;
  };

  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "N/A";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const [query, setQuery] = useState(getInitialQuery());
  const [results, setResults] = useState<TorrentResult[]>([]);
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center gap-2 border-b border-gray-200 pb-4 dark:border-gray-800">
        <Database className="h-5 w-5 text-blue-500" />
        <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Torrent Search
        </h4>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
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
        <div className="relative">
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

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
          <thead className="bg-gray-50 dark:bg-white/[0.02]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Release Name ({filteredResults.length})</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Size</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">S/L</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
            {filteredResults.length > 0 ? (
              filteredResults.map((res) => (
                <tr key={res.infoHash} className="hover:bg-gray-50 dark:hover:bg-white/[0.01]">
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    <span className="font-medium line-clamp-1">{res.title || "Unknown Release"}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {formatBytes(res.size)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    <span className="text-green-500">{res.seeders}</span> / <span className="text-gray-400">{res.leechers}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" size="sm">
                      <Download className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
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