"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type { Download } from "@/types/downloads";
import DeleteDownloadModal from "./DeleteDownloadModal";
import DownloadRow from "./DownloadRow";

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
