"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { deleteDownloadAction } from "@/actions/downloads";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import type { Download } from "@/types/downloads";

interface DeleteDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  download: Download | null;
}

const ERROR_CLASS =
  "text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";

export default function DeleteDownloadModal({
  isOpen,
  onClose,
  download,
}: DeleteDownloadModalProps) {
  const t = useTranslations("downloads.deleteModal");
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Clear any leftover error every time the dialog opens, so a
  // cancel-then-reopen never shows a stale message.
  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  if (!download) return null;

  const handleConfirm = async () => {
    setIsPending(true);
    setError(null);

    try {
      const result = await deleteDownloadAction(download.mediaSourceId);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      onClose();
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[500px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-6 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Trash2 className="size-6 text-error-500" />
            {t("title")}
          </h4>
        </div>
        <div className="px-2 space-y-5">
          {error && <p className={ERROR_CLASS}>{error}</p>}

          <p className="text-gray-600 dark:text-gray-300">
            {t.rich("message", {
              target: download.label,
              b: (chunks) => (
                <span className="font-medium text-gray-800 dark:text-white">
                  {chunks}
                </span>
              ),
            })}
          </p>
        </div>
        <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
          <Button size="sm" variant="outline" onClick={onClose} type="button">
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            type="button"
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isPending ? t("deleting") : t("confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
