"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import type { IndexerDefinition } from "@/types/indexer";

interface IndexerCatalogRowProps {
  definition: IndexerDefinition;
  onAdd: (definitionName: string) => Promise<string | null>;
}

// Spec 112, REQ-12
export default function IndexerCatalogRow({
  definition,
  onAdd,
}: IndexerCatalogRowProps) {
  const t = useTranslations("indexers.modal");
  const [state, setState] = useState<"idle" | "adding" | "added" | "failed">(
    definition.configured ? "added" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    setState("adding");
    setError(null);
    const message = await onAdd(definition.definitionName);

    if (message) {
      setError(message);
      setState("failed");
      return;
    }

    setState("added");
  };

  return (
    <li className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-medium text-gray-800 dark:text-white/90">
            {definition.name}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {definition.language && (
              <Badge color="light">{definition.language}</Badge>
            )}
            {definition.categories.map((category) => (
              <Badge key={category} color="info">
                {t(`categories.${category}`)}
              </Badge>
            ))}
          </div>
          {definition.needsFlareSolverr && (
            <p className="mt-1.5 text-theme-sm text-gray-500 dark:text-gray-400">
              {t("flaresolverrNote")}
            </p>
          )}
        </div>
        {state === "added" ? (
          <Badge color="success">{t("added")}</Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={state === "adding"}
            onClick={handleAdd}
            className="shrink-0"
          >
            {state === "adding" ? t("adding") : t("add")}
          </Button>
        )}
      </div>
      {state === "failed" && error && (
        <p className="mt-2 text-theme-sm text-error-500">{error}</p>
      )}
    </li>
  );
}
