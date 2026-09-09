"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/button/Button";
import { MEDIA_TYPE } from "@/types/media";
import type { MediaSearchResult } from "@/types/search";

interface MediaResultActionProps {
  item: MediaSearchResult;
  owned: boolean;
  ownedMediaId: string | null;
  adding: boolean;
  onAdd: (item: MediaSearchResult) => void;
  // REQ-5: the "add as short" affordance is a film-only, shorts-enabled
  // extra offered alongside the plain add — never a replacement for it.
  shortsEnabled?: boolean;
  addingShort?: boolean;
  onAddAsShort?: (item: MediaSearchResult) => void;
}

// Shared by SearchContainer (/movies/add, /shows/add) and MultiSearchResults
// (/search) so a card's add/owned action has exactly one implementation
// regardless of which screen renders it.
export function MediaResultAction({
  item,
  owned,
  ownedMediaId,
  adding,
  onAdd,
  shortsEnabled = false,
  addingShort = false,
  onAddAsShort,
}: MediaResultActionProps) {
  const t = useTranslations("search.container");

  if (owned) {
    const href =
      item.type === MEDIA_TYPE.SHOW
        ? `/shows/${ownedMediaId}`
        : `/movies/${ownedMediaId}`;

    return (
      <Link
        href={href}
        className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-medium text-white shadow-theme-xs transition hover:bg-brand-600"
      >
        {t("go")}
      </Link>
    );
  }

  const showAddAsShort =
    shortsEnabled && item.type === MEDIA_TYPE.MOVIE && onAddAsShort;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <Button
        size="sm"
        onClick={() => onAdd(item)}
        startIcon={<Plus />}
        disabled={adding || addingShort}
      >
        {adding ? t("adding") : t("addButton")}
      </Button>
      {showAddAsShort && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAddAsShort(item)}
          startIcon={<Plus />}
          disabled={adding || addingShort}
        >
          {addingShort ? t("addingShort") : t("addShortButton")}
        </Button>
      )}
    </div>
  );
}
