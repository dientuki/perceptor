"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { useModal } from "@/hooks/useModal";
import { type ErrorTranslator, translateErrorKey } from "@/lib/graphql-error";
import type { SubtitleSearch, SubtitleSearchResult } from "@/types/media";

interface SearchSubtitlesButtonProps {
  search: SubtitleSearch | null | undefined;
  onSearch: () => Promise<SubtitleSearchResult>;
  compact?: boolean;
  fullWidth?: boolean;
}

const IN_FLIGHT_STATUSES = ["WAITING", "SEARCHING", "VALIDATING", "EMBEDDING"];

const ERROR_CLASS =
  "text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";

// Spec 106, REQ-9
export default function SearchSubtitlesButton({
  search,
  onSearch,
  compact = false,
  fullWidth = false,
}: SearchSubtitlesButtonProps) {
  const t = useTranslations("media.searchSubtitles");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { isOpen, openModal, closeModal } = useModal();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const inFlight = search ? IN_FLIGHT_STATUSES.includes(search.status) : false;

  const handleOpen = () => {
    setError(null);
    openModal();
  };

  const handleConfirm = async () => {
    setIsPending(true);
    setError(null);
    try {
      const result = await onSearch();
      if ("search" in result) {
        closeModal();
        router.refresh();
        return;
      }
      setError(
        translateErrorKey(
          tErrors as ErrorTranslator,
          result.errorKey,
          undefined,
          result.error,
        ),
      );
      if (result.errorKey === "error.subtitleSearch.in_progress") {
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={inFlight}
        onClick={handleOpen}
        title={inFlight ? t("inProgress") : t("button")}
        className={fullWidth ? "w-full" : ""}
      >
        <Search size={compact ? 16 : 18} />
        {!compact && t("button")}
      </Button>
      {inFlight && !compact && (
        <p className="w-full text-base text-gray-500 dark:text-gray-400">
          {t("inProgress")}
        </p>
      )}
      <Modal isOpen={isOpen} onClose={closeModal} className="max-w-[500px] m-4">
        <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
          <div className="px-2 pr-14">
            <h4 className="mb-6 text-2xl font-semibold text-gray-800 dark:text-white/90">
              {t("title")}
            </h4>
          </div>
          <div className="px-2 space-y-5">
            {error && (
              <p role="alert" className={ERROR_CLASS}>
                {error}
              </p>
            )}
            <p className="text-gray-600 dark:text-gray-300">{t("body")}</p>
          </div>
          <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={closeModal}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              type="button"
              disabled={isPending}
              onClick={handleConfirm}
            >
              {isPending ? t("searching") : t("confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
