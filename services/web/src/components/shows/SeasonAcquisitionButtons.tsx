"use client";

import { FileVideo, Magnet, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/button/Button";

/**
 * The three season-level acquisition buttons on a season accordion header —
 * search, import file (disabled, REQ-2) and magnet — same order, icons,
 * sizes and title keys as `EpisodeRow`'s own three buttons in
 * `SeasonAccordion.tsx` (059-season-pack-acquisition-ui).
 */
export default function SeasonAcquisitionButtons({
  onSearch,
  onMagnet,
}: {
  onSearch: () => void;
  onMagnet: () => void;
}) {
  const t = useTranslations("shows.seasonAccordion");
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        title={t("searchButtonTitle")}
        onClick={onSearch}
      >
        <Search size={16} />
      </Button>
      <Button
        size="sm"
        variant="outline"
        title={t("importFileButtonTitle")}
        disabled
      >
        <FileVideo size={16} />
      </Button>
      <Button
        size="sm"
        variant="outline"
        title={t("addTorrentButtonTitle")}
        onClick={onMagnet}
      >
        <Magnet size={16} className="text-red-500" />
      </Button>
    </div>
  );
}
