"use client";

import { Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { startDownloadAction, stopDownloadAction } from "@/actions/downloads";
import StatusBadge from "@/components/status/StatusBadge";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type { Download } from "@/types/downloads";
import DeleteDownloadModal from "./DeleteDownloadModal";

function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return "—";
  if (bytesPerSecond === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytesPerSecond / k ** index).toFixed(1))} ${sizes[index]}`;
}

function formatProgress(progress: number | null): string {
  // progress arrives 0..100 already — do not multiply by 100 again.
  if (progress === null) return "—";
  return `${parseFloat(progress.toFixed(1))}%`;
}

interface DownloadRowProps {
  download: Download;
  onDeleteRequest: (download: Download) => void;
}

function DownloadRow({ download, onDeleteRequest }: DownloadRowProps) {
  const t = useTranslations("downloads.panel");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  // The controllability test is `infoHash != null` — not `kind` (SourceKind
  // has two torrent values and there is no codegen to catch a wrong
  // literal) and not `progress` (a torrent missing from qBittorrent has
  // null progress and still needs its delete button).
  const isControllable = download.infoHash != null;

  const handleStart = () => {
    setRowError(null);
    startTransition(async () => {
      const result = await startDownloadAction(download.mediaSourceId);
      if ("error" in result) {
        setRowError(result.error || t("startErrorDefault"));
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

  return (
    <tr>
      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
        <div className="font-medium">{download.label}</div>
        {download.releaseTitle && (
          <div className="mt-1 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
            {download.releaseTitle}
          </div>
        )}
        {rowError && (
          <div className="mt-1 text-xs text-error-500">{rowError}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={download.status} />
      </td>
      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-full min-w-[6rem] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${download.downloadProgress ?? 0}%` }}
              />
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs">
              {formatProgress(download.downloadProgress)}
            </span>
          </div>
          {download.compressionEnabled && (
            <div className="flex items-center gap-2">
              <div className="h-2 w-full min-w-[6rem] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${download.encodeProgress ?? 0}%` }}
                />
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs">
                {formatProgress(download.encodeProgress)}
              </span>
            </div>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">
        {formatSpeed(download.downloadSpeed)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {isControllable && (
            <>
              <Button
                size="sm"
                variant="outline"
                title={t("startTitle")}
                disabled={isPending}
                onClick={handleStart}
              >
                <Play size={16} />
              </Button>
              <Button
                size="sm"
                variant="outline"
                title={t("stopTitle")}
                disabled={isPending}
                onClick={handleStop}
              >
                <Square size={16} />
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            title={t("deleteTitle")}
            disabled={isPending}
            onClick={() => onDeleteRequest(download)}
          >
            <Trash2 size={16} className="text-error-500" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function DownloadsPanel({
  downloads,
}: {
  downloads: Download[];
}) {
  const t = useTranslations("downloads.panel");
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<Download | null>(null);
  const {
    isOpen: isDeleteModalOpen,
    openModal: openDeleteModal,
    closeModal: closeDeleteModal,
  } = useModal();

  const handleRefresh = () => {
    startRefresh(() => {
      router.refresh();
    });
  };

  const handleDeleteRequest = (download: Download) => {
    setDeleteTarget(download);
    openDeleteModal();
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between px-5 py-4">
        <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
          {t("title")}
        </h4>
        <Button
          size="sm"
          variant="outline"
          disabled={isRefreshing}
          onClick={handleRefresh}
        >
          <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
          {isRefreshing ? t("refreshing") : t("refresh")}
        </Button>
      </div>

      {downloads.length === 0 ? (
        <div className="border-t border-gray-200 px-5 py-6 text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {t("empty")}
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-gray-200 dark:border-gray-800">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            <thead className="bg-gray-50 dark:bg-white/[0.02]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("targetHeader")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("statusHeader")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("progressHeader")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("speedHeader")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("actionsHeader")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-transparent">
              {downloads.map((download) => (
                <DownloadRow
                  key={download.mediaSourceId}
                  download={download}
                  onDeleteRequest={handleDeleteRequest}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DeleteDownloadModal
        isOpen={isDeleteModalOpen}
        onClose={closeDeleteModal}
        download={deleteTarget}
      />
    </div>
  );
}
