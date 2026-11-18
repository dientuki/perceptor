"use client";

import { useTranslations } from "next-intl";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import type { SubtitleProvider } from "@/types/subtitle-providers";

interface SubtitleProviderRowProps {
  provider: SubtitleProvider;
  onEdit: () => void;
  onRemove: () => void;
}

// Spec 121, REQ-3
export default function SubtitleProviderRow({
  provider,
  onEdit,
  onRemove,
}: SubtitleProviderRowProps) {
  const t = useTranslations("subtitleProviders");

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-800 dark:text-white/90">
            {t(`name.${provider.kind}`)}
          </span>
          <Badge color="success" size="sm">
            {t("configured")}
          </Badge>
          {provider.isDefault && (
            <Badge color="primary" size="sm">
              {t("default")}
            </Badge>
          )}
        </div>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400 break-words">
          {provider.username
            ? t("row.username", { username: provider.username })
            : null}
          {provider.username && provider.secretSet ? " · " : null}
          {provider.secretSet ? t("row.secretSet") : null}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          {t("edit")}
        </Button>
        <Button size="sm" variant="danger" onClick={onRemove}>
          {t("remove")}
        </Button>
      </div>
    </li>
  );
}
