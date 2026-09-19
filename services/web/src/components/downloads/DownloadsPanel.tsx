"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Fragment, useState, useTransition } from "react";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import { groupByTitle } from "@/lib/download-groups";
import { statusTone } from "@/lib/status-tone";
import type { Download } from "@/types/downloads";
import DeleteDownloadModal from "./DeleteDownloadModal";
import DownloadGroupHeader from "./DownloadGroupHeader";
import DownloadRow from "./DownloadRow";
import DownloadsPagination from "./DownloadsPagination";

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

const DEFAULT_PAGE_SIZE = 10;

interface DownloadsPanelProps {
  downloads: Download[];
  grouped?: boolean;
  emptyText?: string;
}

export default function DownloadsPanel({
  downloads,
  grouped = false,
  emptyText,
}: DownloadsPanelProps) {
  const t = useTranslations("downloads.panel");
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<Bucket | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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

  const groups = grouped ? groupByTitle(visible) : [];
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * pageSize;
  const pageGroups = groups.slice(startIndex, startIndex + pageSize);

  const handleFilter = (bucket: Bucket) => {
    setFilter(filter === bucket ? null : bucket);
    setPage(1);
  };

  const handlePageSize = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const renderRow = (download: Download) => (
    <DownloadRow
      key={download.mediaSourceId}
      download={download}
      onDeleteRequest={handleDeleteRequest}
    />
  );

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
              onClick={() => handleFilter(bucket)}
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
          {emptyText ?? t("empty")}
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
              {grouped
                ? pageGroups.map((group) => (
                    <Fragment key={group.key}>
                      {group.downloads.length >= 2 && (
                        <DownloadGroupHeader
                          title={group.title}
                          count={group.downloads.length}
                        />
                      )}
                      {group.downloads.map(renderRow)}
                    </Fragment>
                  ))
                : visible.map(renderRow)}
            </tbody>
          </table>
        </div>
      )}

      {grouped && groups.length >= 1 && (
        <div className="border-t border-gray-200 px-5 py-4 dark:border-gray-800">
          <DownloadsPagination
            page={currentPage}
            pageCount={pageCount}
            from={startIndex + 1}
            to={startIndex + pageGroups.length}
            total={groups.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={handlePageSize}
          />
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
