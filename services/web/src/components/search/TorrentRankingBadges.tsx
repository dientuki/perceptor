import { ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RankedTorrentResult } from "@/lib/torrent-ranking";

interface TorrentRankingBadgesProps {
  ranking: RankedTorrentResult["ranking"];
}

// Extracted out of SearchTorrent.tsx's "Best candidates" toggle so it can be
// reused on other screens in a future iteration — not currently rendered
// anywhere. See 036-torrent-ranking-heuristic for what each label means.
export default function TorrentRankingBadges({
  ranking,
}: TorrentRankingBadgesProps) {
  const t = useTranslations("search.torrent");

  const entries = (
    [
      ["resolution", ranking.resolutionLabel],
      ["group", ranking.groupLabel],
      ["source", ranking.sourceLabel],
      ["codec", ranking.codecLabel],
      ["range", ranking.dynamicRangeLabel],
      ["audio", ranking.audioLabel],
      ["language", ranking.matchedLanguage],
    ] as [string, string | null][]
  ).filter((entry): entry is [string, string] => entry[1] !== null);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {entries.map(([criterion, label]) => (
        <span
          key={criterion}
          className="inline-flex items-center gap-0.5 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
        >
          {label}
          {criterion === "source" && ranking.sourcePromoted && (
            <span title={t("sourcePromoted")}>
              <ArrowUp className="h-2.5 w-2.5" aria-label={t("sourcePromoted")} />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
