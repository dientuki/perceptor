"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
  getConfiguredIndexersAction,
  removeIndexerAction,
} from "@/actions/indexer";
import AddIndexerButton from "@/components/indexers/AddIndexerButton";
import RemoveIndexerModal from "@/components/indexers/RemoveIndexerModal";
import Badge from "@/components/ui/badge/Badge";
import type { ConfiguredIndexer } from "@/types/indexer";

const NOT_FOUND_KEY = "error.indexer.not_found";

// Spec 112, REQ-11 REQ-14
export default function IndexerSection() {
  const t = useTranslations("indexers");
  const [indexers, setIndexers] = useState<ConfiguredIndexer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ConfiguredIndexer | null>(null);

  const load = useCallback(async () => {
    const result = await getConfiguredIndexersAction();

    if (result.ok) {
      setIndexers(result.data);
      setError(null);
    } else {
      setIndexers(null);
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = async (): Promise<string | null> => {
    if (!removing) return null;

    const result = await removeIndexerAction(removing.id);

    if (result.ok) {
      await load();
      return null;
    }

    if (result.errorKey === NOT_FOUND_KEY) {
      await load();
      setError(result.error);
      return null;
    }

    return result.error;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
          {t("section.title")}
        </h3>
        <AddIndexerButton onAdded={load} />
      </div>

      {error && <p className="mb-3 text-error-500">{error}</p>}

      {indexers === null ? (
        !error && (
          <p className="text-base text-gray-500 dark:text-gray-400">
            {t("section.loading")}
          </p>
        )
      ) : indexers.length === 0 ? (
        <p className="text-base text-gray-500 dark:text-gray-400">
          {t("section.empty")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {indexers.map((indexer) => (
            <Badge
              key={indexer.id}
              color="primary"
              endIcon={
                <button
                  type="button"
                  aria-label={t("section.removeAria", { name: indexer.name })}
                  onClick={() => setRemoving(indexer)}
                  className="inline-flex items-center justify-center max-md:min-h-11 max-md:min-w-11"
                >
                  <X size={14} />
                </button>
              }
            >
              {indexer.name}
              {indexer.usesFlareSolverr && (
                <span className="ml-1 opacity-70">
                  · {t("section.flaresolverr")}
                </span>
              )}
              {!indexer.enabled && (
                <span className="ml-1 opacity-70">
                  · {t("section.disabled")}
                </span>
              )}
            </Badge>
          ))}
        </div>
      )}

      <RemoveIndexerModal
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        name={removing?.name ?? ""}
        onConfirm={handleRemove}
      />
    </div>
  );
}
