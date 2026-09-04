"use client";

import { ArrowUp, Download, Loader2, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  addTorrentToMovieAction,
  searchTorrentsAction,
} from "@/actions/indexer";
import { getPreferences } from "@/actions/preferences";
import { addTorrentToEpisodeAction } from "@/actions/shows";
import ReplaceWarning from "@/components/import/ReplaceWarning";
import Button from "@/components/ui/button/Button";
import type {
  LanguageRequirement,
  RankedTorrentResult,
} from "@/lib/torrent-ranking";
import { rankTorrentResults } from "@/lib/torrent-ranking";
import type { TorrentResult } from "@/types/indexer";
import type { AcquisitionResult, AcquisitionTarget } from "@/types/media";
import type { UserPreferences } from "@/types/preferences";

interface SearchTorrentProps {
  target: AcquisitionTarget | null;
  onClose?: () => void;
}

// The three "a finished file is about to be destroyed" keys. A downloading
// target no longer conflicts at all (022-download-status-tags REQ-7), so
// there is no second, weaker key family to sit beside these.
const ALREADY_COMPLETED_KEYS = [
  "error.movie.already_completed",
  "error.episode.already_completed",
  "error.season.already_completed",
];

export default function SearchTorrent({ target, onClose }: SearchTorrentProps) {
  const t = useTranslations("search.torrent");

  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "N/A";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TorrentResult[]>([]);
  const [filter, setFilter] = useState("");
  const [showBest, setShowBest] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState<TorrentResult | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const router = useRouter();

  // Fetched once per mount, independent of `target` — the caller's own preferences are what a
  // title with nothing configured of its own falls back to (see the language/group merge below).
  useEffect(() => {
    getPreferences()
      .then(setPreferences)
      .catch(() => setPreferences(null));
  }, []);

  useEffect(() => {
    if (!target) return;

    if (target.kind === "movie") {
      setQuery(target.movie.title);
    } else {
      // Limpiar caracteres raros del nombre de la serie
      const cleanShowTitle = (target.showTitle || "")
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const s = String(target.seasonNumber ?? 0).padStart(2, "0");
      const e = String(target.episode.episodeNumber ?? 0).padStart(2, "0");
      setQuery(`${cleanShowTitle} S${s}E${e}`.trim());
    }
  }, [target]);

  // REQ-25 — the mandatory audio-language requirement of the title being acquired, read off
  // `target` itself: the movie's own fields for a film, the parent series' fields (threaded
  // through the episode branch, see T011) for an episode. When the title carries no audio
  // languages of its own, fall back to the caller's global `/preferences` (downloadLanguages tab)
  // instead of ranking as if no requirement existed at all — a title's per-title config and the
  // user's own default are two different tables (UserMovie/UserMovieLanguage vs UserPreferences)
  // with nothing merging them anywhere else, so this is the one place that does. `undefined` for a
  // null target keeps `rankTorrentResults` on its no-op path rather than passing an armed-looking
  // empty object.
  const titleAudio = target
    ? target.kind === "movie"
      ? {
          mandatory: target.movie.audioMandatory,
          languages: target.movie.audioLanguages,
        }
      : {
          mandatory: target.audioMandatory,
          languages: target.audioLanguages,
        }
    : null;
  const usingGlobalLanguages =
    titleAudio !== null && titleAudio.languages.length === 0;
  const languageRequirement: LanguageRequirement | undefined = titleAudio
    ? usingGlobalLanguages && preferences
      ? {
          mandatory: preferences.audioMandatory,
          languages: preferences.audioLanguages,
        }
      : titleAudio
    : undefined;

  // Same idea for the preferred-groups tiebreak — `UserPreferences.movieTorrentGroups`/
  // `showTorrentGroups`, picked by this target's kind. There is no per-title override for
  // groups, only the user's global preference.
  const preferredGroups = preferences
    ? (target?.kind === "movie"
        ? preferences.movieTorrentGroups
        : preferences.showTorrentGroups
      ).map((g) => g.name)
    : [];

  // The candidate view derives from `results` without ever mutating it — REQ-16/AC-5 depend on
  // `results` surviving in the API's original order for as long as the modal is open.
  const candidateResults: (TorrentResult | RankedTorrentResult)[] = showBest
    ? rankTorrentResults(results, languageRequirement, preferredGroups)
    : results;

  const filteredResults = candidateResults.filter((res) =>
    (res.title || "").toLowerCase().includes(filter.toLowerCase()),
  );

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setSearchError(null);
    setResults([]);
    setShowBest(false);
    try {
      const data = await searchTorrentsAction(query);
      setResults(data);
    } catch (error) {
      console.error({ error, query }, "Error al buscar torrents");
      setResults([]);
      setSearchError(
        error instanceof Error ? error.message : t("searchErrorDefault"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const isCompleted =
    target !== null &&
    (target.kind === "movie"
      ? target.movie.status === "COMPLETED"
      : target.episode.status === "COMPLETED");

  const targetLabel = target
    ? target.kind === "movie"
      ? target.movie.title
      : `${target.showTitle} S${String(target.seasonNumber).padStart(2, "0")}E${String(target.episode.episodeNumber).padStart(2, "0")}`
    : "";

  const submitTorrent = async (
    res: TorrentResult,
    force: boolean,
  ): Promise<AcquisitionResult | null> => {
    if (!target) return null;

    const urls = res.items
      .map((i) => i.downloadUrl)
      .filter((u): u is string => !!u);

    if (target.kind === "movie") {
      return await addTorrentToMovieAction(
        Number(target.movie.id),
        res.infoHash,
        urls,
        res.title,
        force,
      );
    }
    return await addTorrentToEpisodeAction(
      Number(target.episode.id),
      res.infoHash,
      urls,
      res.title,
      force,
    );
  };

  const handleAddTorrent = async (res: TorrentResult) => {
    setAddingId(res.id);
    setAddError(null);
    setNeedsConfirm(null);

    const result = await submitTorrent(res, isCompleted);
    if (result && "error" in result) {
      setAddError(result.error);
      if (result.errorKey && ALREADY_COMPLETED_KEYS.includes(result.errorKey)) {
        setNeedsConfirm(res);
      }
    } else {
      router.refresh();
    }
    setAddingId(null);
  };

  const handleConfirmReplace = async (res: TorrentResult) => {
    setAddingId(res.id);
    setAddError(null);

    const result = await submitTorrent(res, true);
    if (result && "error" in result) {
      setAddError(result.error);
    } else {
      setNeedsConfirm(null);
      router.refresh();
    }
    setAddingId(null);
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
            placeholder={t("inputPlaceholder")}
            className="w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pl-10 pr-4 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-800 dark:text-white"
          />
        </div>
        <Button type="submit" disabled={isLoading} className="min-w-[100px]">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            t("searchButton")
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="md"
          startIcon={<Sparkles className="h-4 w-4" />}
          disabled={isLoading || results.length === 0}
          onClick={() => setShowBest((prev) => !prev)}
        >
          {t(showBest ? "rankButtonReset" : "rankButton")}
        </Button>
      </form>

      {isCompleted && (
        <div className="flex-shrink-0">
          <ReplaceWarning target={targetLabel} />
        </div>
      )}

      {results.length > 0 && (
        <div className="relative flex-shrink-0">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("filterPlaceholder")}
            className="w-full rounded-lg border border-gray-200 bg-transparent py-2 pl-10 pr-4 outline-none transition focus:border-blue-500 dark:border-gray-800 dark:text-white"
          />
        </div>
      )}

      {searchError && (
        <div className="flex-shrink-0 rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-500/10 dark:text-red-400">
          <p>{searchError}</p>
        </div>
      )}

      {addError && (
        <div className="flex-shrink-0 rounded-lg bg-red-50 px-4 py-3 text-red-700 dark:bg-red-500/10 dark:text-red-400">
          <p>{addError}</p>
          {needsConfirm && (
            <div className="mt-2 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleConfirmReplace(needsConfirm)}
                disabled={addingId === needsConfirm.id}
                type="button"
              >
                {addingId === needsConfirm.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("replace")
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNeedsConfirm(null);
                  setAddError(null);
                }}
                type="button"
              >
                {t("cancel")}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <table className="w-full flex-1 flex flex-col min-h-0 divide-y divide-gray-200 dark:divide-gray-800">
          <thead className="block flex-shrink-0 bg-gray-50 dark:bg-white/[0.02]">
            <tr className="grid grid-cols-[minmax(0,1fr)_100px_100px_80px] items-center w-full">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t("releaseNameHeader", { count: filteredResults.length })}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
                {t("sizeHeader")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
                {t("slHeader")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t("actionHeader")}
              </th>
            </tr>
          </thead>
          <tbody className="block flex-1 min-h-0 divide-y divide-gray-200 overflow-y-auto dark:divide-gray-800">
            {filteredResults.length > 0 ? (
              filteredResults.map((res) => (
                <tr
                  key={res.id}
                  className="grid grid-cols-[minmax(0,1fr)_100px_100px_80px] items-center hover:bg-gray-50 dark:hover:bg-white/[0.01]"
                >
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                    <span className="font-medium line-clamp-2">
                      {res.title || t("unknownRelease")}
                    </span>
                    {showBest && "ranking" in res && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {(
                          [
                            ["resolution", res.ranking.resolutionLabel],
                            ["group", res.ranking.groupLabel],
                            ["source", res.ranking.sourceLabel],
                            ["codec", res.ranking.codecLabel],
                            ["range", res.ranking.dynamicRangeLabel],
                            ["audio", res.ranking.audioLabel],
                            // REQ-14 (0.5.0) — the matched mandatory audio language, one more chip
                            // in the same row. `null` whenever the requirement is absent/unarmed
                            // or this release matched none of it, so nothing renders in that case.
                            ["language", res.ranking.matchedLanguage],
                          ] as [string, string | null][]
                        )
                          .filter(
                            (entry): entry is [string, string] =>
                              entry[1] !== null,
                          )
                          .map(([criterion, label]) => (
                            <span
                              key={criterion}
                              className="inline-flex items-center gap-0.5 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                            >
                              {label}
                              {/* REQ-14 (0.5.0) — the source chip's promotion marker: a promoted
                                  `BluRay Remux` must not be indistinguishable from a genuine one at
                                  the same adjusted rank. Visual + an accessible label, no new
                                  format-identifier chip. */}
                              {criterion === "source" &&
                                res.ranking.sourcePromoted && (
                                  <span title={t("sourcePromoted")}>
                                    <ArrowUp
                                      className="h-2.5 w-2.5"
                                      aria-label={t("sourcePromoted")}
                                    />
                                  </span>
                                )}
                            </span>
                          ))}
                      </div>
                    )}
                    <div className="mt-1 flex flex-col gap-0.5 overflow-hidden">
                      {res.infoUrl.map(
                        (indexerItem, idx) =>
                          indexerItem.downloadUrl && (
                            <a
                              key={idx}
                              href={indexerItem.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-blue-500 hover:underline dark:text-blue-400 line-clamp-1"
                            >
                              {indexerItem.downloadUrl}
                            </a>
                          ),
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">
                    {formatBytes(res.size)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="text-green-500">{res.seeders}</span> /{" "}
                    <span className="text-gray-400">{res.leechers}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddTorrent(res)}
                      disabled={addingId === res.id}
                    >
                      {addingId === res.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                  </td>
                </tr>
              ))
            ) : (
              <tr className="flex w-full">
                <td className="flex-1 px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                  {isLoading
                    ? t("searchingTrackers")
                    : showBest &&
                        candidateResults.length === 0 &&
                        results.length > 0
                      ? t("rankEmpty")
                      : results.length > 0
                        ? t("noFilterMatch")
                        : t("noResultsYet")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
