"use client";

import { Subtitles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import EmbedSubtitlesModal from "@/components/media/EmbedSubtitlesModal";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type {
  ExternalSubtitle,
  SubtitleEmbed,
  SubtitleEmbedInput,
  SubtitleEmbedResult,
} from "@/types/media";

interface EmbedSubtitlesButtonProps {
  subtitles: ExternalSubtitle[];
  embed: SubtitleEmbed | null | undefined;
  onEmbed: (subtitles: SubtitleEmbedInput[]) => Promise<SubtitleEmbedResult>;
  compact?: boolean;
  fullWidth?: boolean;
}

// Spec 101, REQ-17
export default function EmbedSubtitlesButton({
  subtitles,
  embed,
  onEmbed,
  compact = false,
  fullWidth = false,
}: EmbedSubtitlesButtonProps) {
  const t = useTranslations("media.embedSubtitles");
  const router = useRouter();
  const { isOpen, openModal, closeModal } = useModal();
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  // Spec 113, REQ-7
  const inFlight =
    embed != null && embed.status !== "COMPLETED" && embed.status !== "FAILED";
  const inFlightLabel =
    embed?.status === "SYNCING" ? t("syncing") : t("embedding");

  if (subtitles.length === 0 && !inFlight) return null;

  const handleStale = (message: string) => {
    closeModal();
    setStaleMessage(message);
    router.refresh();
  };

  const handleEmbedded = () => {
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
      {inFlight ? (
        <Button
          size="sm"
          variant="outline"
          disabled
          title={inFlightLabel}
          className={fullWidth ? "w-full" : ""}
        >
          <Subtitles size={compact ? 16 : 18} />
          {!compact && inFlightLabel}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={handleOpen}
          title={t("button")}
          className={fullWidth ? "w-full" : ""}
        >
          <Subtitles size={compact ? 16 : 18} />
          {!compact && t("button")}
        </Button>
      )}
      {compact && inFlight && (
        <span className="text-base text-gray-500 dark:text-gray-400">
          {inFlightLabel}
        </span>
      )}
      {staleMessage && (
        <p role="alert" className="w-full text-base text-error-500">
          {staleMessage}
        </p>
      )}
      {!inFlight && (
        <EmbedSubtitlesModal
          isOpen={isOpen}
          onClose={closeModal}
          subtitles={subtitles}
          onEmbed={onEmbed}
          onStale={handleStale}
          onEmbedded={handleEmbedded}
        />
      )}
    </>
  );
}
