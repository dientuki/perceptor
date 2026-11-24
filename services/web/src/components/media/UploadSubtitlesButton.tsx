"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import UploadSubtitlesModal from "@/components/media/UploadSubtitlesModal";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type {
  SubtitleEmbed,
  SubtitleEmbedResult,
  SubtitleSearch,
  SubtitleUploadInput,
} from "@/types/media";

interface UploadSubtitlesButtonProps {
  embed: SubtitleEmbed | null | undefined;
  search: SubtitleSearch | null | undefined;
  fileSubtitleLanguages: string[] | null | undefined;
  onUpload: (subtitles: SubtitleUploadInput[]) => Promise<SubtitleEmbedResult>;
  compact?: boolean;
}

const SEARCH_TERMINAL = ["COMPLETED", "FAILED"];

// Spec 124, REQ-1 REQ-3
export default function UploadSubtitlesButton({
  embed,
  search,
  fileSubtitleLanguages,
  onUpload,
  compact = false,
}: UploadSubtitlesButtonProps) {
  const t = useTranslations("media.uploadSubtitles");
  const router = useRouter();
  const { isOpen, openModal, closeModal } = useModal();
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  const embedInFlight =
    embed != null && embed.status !== "COMPLETED" && embed.status !== "FAILED";
  const searchInFlight =
    search != null && !SEARCH_TERMINAL.includes(search.status);
  const disabled = embedInFlight || searchInFlight;
  const label = embedInFlight
    ? t("busyEmbed")
    : searchInFlight
      ? t("busySearch")
      : t("button");

  const handleStale = (message: string) => {
    closeModal();
    setStaleMessage(message);
    router.refresh();
  };

  const handleUploaded = () => {
    closeModal();
    setStaleMessage(null);
    router.refresh();
  };

  const handleOpen = () => {
    setStaleMessage(null);
    openModal();
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={handleOpen}
        title={label}
        ariaLabel={label}
      >
        <Upload size={compact ? 16 : 18} />
      </Button>
      {staleMessage && (
        <p role="alert" className="w-full text-base text-error-500">
          {staleMessage}
        </p>
      )}
      {!disabled && (
        <UploadSubtitlesModal
          isOpen={isOpen}
          onClose={closeModal}
          fileSubtitleLanguages={fileSubtitleLanguages}
          onUpload={onUpload}
          onStale={handleStale}
          onUploaded={handleUploaded}
        />
      )}
    </>
  );
}
