"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";

interface RemoveTmdbListModalProps {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  onConfirm: () => Promise<string | null>;
}

const ERROR_CLASS =
  "text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";

// Spec 109, REQ-13
export default function RemoveTmdbListModal({
  isOpen,
  onClose,
  name,
  onConfirm,
}: RemoveTmdbListModalProps) {
  const t = useTranslations("lists.remove");
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
      const message = await onConfirm();

      if (message) {
        setError(message);
        return;
      }

      onClose();
    } finally {
      setIsPending(false);
    }
  };

  const bold = (chunks: React.ReactNode) => (
    <span className="font-medium text-gray-800 dark:text-white break-words">
      {chunks}
    </span>
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
            {t.rich("message", { name, b: bold })}
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
            {isPending ? t("removing") : t("confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
