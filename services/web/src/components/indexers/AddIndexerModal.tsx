"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { addIndexerAction, getIndexerCatalogAction } from "@/actions/indexer";
import IndexerCatalogRow from "@/components/indexers/IndexerCatalogRow";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import type { IndexerDefinition } from "@/types/indexer";

interface AddIndexerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;

// Spec 112, REQ-12
export default function AddIndexerModal({
  isOpen,
  onClose,
  onAdded,
}: AddIndexerModalProps) {
  const t = useTranslations("indexers.modal");
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<IndexerDefinition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearch("");
      setCatalog(null);
      setLoadError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    let stale = false;
    const timer = setTimeout(
      async () => {
        const result = await getIndexerCatalogAction(search);

        if (stale) return;

        if (result.ok) {
          setCatalog(result.data);
          setLoadError(null);
        } else {
          setCatalog(null);
          setLoadError(result.error);
        }
      },
      search === "" ? 0 : SEARCH_DEBOUNCE_MS,
    );

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [isOpen, search]);

  const handleAdd = async (definitionName: string): Promise<string | null> => {
    const result = await addIndexerAction(definitionName);

    if (!result.ok) {
      return result.error;
    }

    onAdded();
    return null;
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[640px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
            {t("title")}
          </h4>
          <p className="mb-5 text-theme-sm text-gray-500 dark:text-gray-400">
            {t("description")}
          </p>
        </div>
        <div className="px-2 space-y-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            aria-label={t("searchLabel")}
            placeholder={t("searchPlaceholder")}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-base text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
          />
          {loadError ? (
            <p className="text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg">
              {loadError}
            </p>
          ) : catalog === null ? (
            <p className="text-base text-gray-500 dark:text-gray-400">
              {t("loading")}
            </p>
          ) : catalog.length === 0 ? (
            <p className="text-base text-gray-500 dark:text-gray-400">
              {t("empty")}
            </p>
          ) : (
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {catalog.map((definition) => (
                <IndexerCatalogRow
                  key={definition.definitionName}
                  definition={definition}
                  onAdd={handleAdd}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
