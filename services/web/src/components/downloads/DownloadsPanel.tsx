"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import { statusTone } from "@/lib/status-tone";
import type { Download } from "@/types/downloads";
import DeleteDownloadModal from "./DeleteDownloadModal";
import DownloadRow from "./DownloadRow";

type Bucket = "completed" | "working" | "error";

const BUCKETS: Bucket[] = ["completed", "working", "error"];

const TONE_BUCKET: Record<string, Bucket | undefined> = {
  completed: "completed",
  progress: "working",
  error: "error",
};

const BUCKET_LABEL_KEY = {
  completed: "filterCompleted",
  working: "filterWorking",
  error: "filterError",
} as const;

function bucketOf(download: Download): Bucket | undefined {
  return TONE_BUCKET[statusTone(download.status)];
}

export default function DownloadsPanel({
  downloads,
  showTitle,
}: {
  downloads: Download[];
  showTitle?: string;
}) {
  const t = useTranslations("downloads.panel");
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<Bucket | null>(null);
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

  const counts: Record<Bucket, number> = {
    completed: 0,
    working: 0,
    error: 0,
  };
  for (const download of downloads) {
    const bucket = bucketOf(download);
    if (bucket) counts[bucket] += 1;
  }
  const visible =
    filter === null
      ? downloads
      : downloads.filter((download) => bucketOf(download) === filter);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between px-5 py-4">
        <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
          {t("title")}
        </h4>
        <div className="flex items-center gap-2">
          {BUCKETS.map((bucket) => (
            <Button
              key={bucket}
              size="sm"
              variant={filter === bucket ? "primary" : "outline"}
              ariaPressed={filter === bucket}
              onClick={() => setFilter(filter === bucket ? null : bucket)}
            >
              {t(BUCKET_LABEL_KEY[bucket])}
              <Badge size="sm" color={filter === bucket ? "light" : "primary"}>
                {counts[bucket]}
              </Badge>
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={isRefreshing}
            onClick={handleRefresh}
          >
            <RefreshCw
              size={16}
              className={isRefreshing ? "animate-spin" : ""}
            />
            {isRefreshing ? t("refreshing") : t("refresh")}
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
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
                <th className="w-[14rem] px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
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
              {visible.map((download) => (
                <DownloadRow
                  key={download.mediaSourceId}
                  download={download}
                  showTitle={showTitle}
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
