"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { discardEncodeJobAction } from "@/actions/downloads";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import type { DownloadJob } from "@/types/downloads";

interface DiscardJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: DownloadJob;
}

const ERROR_CLASS =
  "text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";

const REFRESH_ON_KEYS = [
  "error.download.retry_replaced",
  "error.download.retry_superseded",
  "error.processJob.not_discardable",
];

export default function DiscardJobModal({
  isOpen,
  onClose,
  job,
}: DiscardJobModalProps) {
  const t = useTranslations("downloads.discardModal");
  const tPanel = useTranslations("downloads.panel");
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    setIsPending(true);
    setError(null);

    try {
      const result = await discardEncodeJobAction(job.processJobId);

      if ("error" in result) {
        setError(result.error || tPanel("discardErrorDefault"));
        if (result.errorKey && REFRESH_ON_KEYS.includes(result.errorKey)) {
          router.refresh();
        }
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
            <X className="size-6 text-error-500" />
            {t("title")}
          </h4>
        </div>
        <div className="px-2 space-y-5">
          {error && <p className={ERROR_CLASS}>{error}</p>}

          <p className="text-gray-600 dark:text-gray-300">
            {t.rich("message", {
              target: job.label,
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
            {isPending ? t("discarding") : t("confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
