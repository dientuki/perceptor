"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import type { TitleRemovalResult } from "@/types/media";

interface RemoveTitleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  // Advisory: read at render time. The mutation's own result is authoritative.
  otherOwners: number;
  hasLibraryFile: boolean;
  redirectTo: string;
  onConfirm: () => Promise<TitleRemovalResult>;
}

const ERROR_CLASS =
  "text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";

export default function RemoveTitleModal({
  isOpen,
  onClose,
  title,
  otherOwners,
  hasLibraryFile,
  redirectTo,
  onConfirm,
}: RemoveTitleModalProps) {
  const t = useTranslations("media.removeTitle");
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Clear any leftover error every time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    setIsPending(true);
    setError(null);

    try {
      const result = await onConfirm();

      if ("error" in result) {
        setError(result.error);
        return;
      }

      onClose();
      router.push(redirectTo);
    } finally {
      setIsPending(false);
    }
  };

  const bold = (chunks: React.ReactNode) => (
    <span className="font-medium text-gray-800 dark:text-white">{chunks}</span>
  );

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
            {t.rich(otherOwners > 0 ? "messageShared" : "messageLast", {
              target: title,
              b: bold,
            })}
          </p>

          {hasLibraryFile && (
            <p className="text-gray-600 dark:text-gray-300">{t("fileStays")}</p>
          )}
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
            {isPending ? t("removing") : t("confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
