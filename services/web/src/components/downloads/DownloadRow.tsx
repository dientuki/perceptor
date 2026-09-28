"use client";

import { Play, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { startDownloadAction, stopDownloadAction } from "@/actions/downloads";
import StatusBadge from "@/components/status/StatusBadge";
import Button from "@/components/ui/button/Button";
import { formatEncodeSpeed, formatSpeed } from "@/lib/format";
import type { Download } from "@/types/downloads";
import DownloadErrorLine from "./DownloadErrorLine";
import DownloadProgressBar from "./DownloadProgressBar";

const REFRESH_ON_KEYS = [
  "error.download.retry_replaced",
  "error.download.retry_superseded",
  "error.download.retry_unavailable",
];

interface DownloadRowProps {
  download: Download;
  onDeleteRequest: (download: Download) => void;
}

export default function DownloadRow({
  download,
  onDeleteRequest,
}: DownloadRowProps) {
  const t = useTranslations("downloads.panel");
  const tSeason = useTranslations("shows.seasonAccordion");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const isControllable = download.owned && download.infoHash != null;

  const canStart =
    download.status === "ERROR"
      ? download.owned && download.retryable
      : isControllable;

  const handleStart = () => {
    setRowError(null);
    startTransition(async () => {
      const result = await startDownloadAction(download.mediaSourceId);
      if ("error" in result) {
        setRowError(result.error || t("startErrorDefault"));
        if (result.errorKey && REFRESH_ON_KEYS.includes(result.errorKey)) {
          router.refresh();
        }
        return;
      }
      router.refresh();
    });
  };

  const handleStop = () => {
    setRowError(null);
    startTransition(async () => {
      const result = await stopDownloadAction(download.mediaSourceId);
      if ("error" in result) {
        setRowError(result.error || t("stopErrorDefault"));
        return;
      }
      router.refresh();
    });
  };

  const displayName =
    download.seasonNumber != null && download.showTitle
      ? `${download.showTitle} ${tSeason("seasonLabel", { number: download.seasonNumber })}`
      : download.label;

  return (
    <tr>
      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
        <div className="font-medium">{displayName}</div>
        {download.releaseTitle && (
          <div className="mt-1 break-words text-base text-gray-500 dark:text-gray-400">
            {download.releaseTitle}
          </div>
        )}
        {download.lastError && <DownloadErrorLine error={download.lastError} />}
        {rowError && (
          <div className="mt-1 text-base text-error-500">{rowError}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={download.status} />
      </td>
      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
        <div className="flex flex-col gap-2">
          <DownloadProgressBar progress={download.downloadProgress} />
          {download.compressionEnabled && (
            <DownloadProgressBar progress={download.encodeProgress} />
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">
        {download.status === "ENCODING"
          ? formatEncodeSpeed(download.encodeSpeed)
          : formatSpeed(download.downloadSpeed)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {canStart && (
            <Button
              size="sm"
              variant="outline"
              title={t("startTitle")}
              disabled={isPending}
              onClick={handleStart}
            >
              <Play size={16} />
            </Button>
          )}
          {isControllable && (
            <Button
              size="sm"
              variant="outline"
              title={t("stopTitle")}
              disabled={isPending}
              onClick={handleStop}
            >
              <Square size={16} />
            </Button>
          )}
          {download.owned && (
            <Button
              size="sm"
              variant="outline"
              title={t("deleteTitle")}
              disabled={isPending}
              onClick={() => onDeleteRequest(download)}
            >
              <Trash2 size={16} className="text-error-500" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
