"use client";
import { Magnet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";
import { useEffect, useState } from "react";
import { importMagnetAction } from "@/actions/imports";
import { addMagnetToEpisodeAction } from "@/actions/shows";
import Label from "@/components/form/Label";
import ReplaceWarning from "@/components/import/ReplaceWarning";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import type { AcquisitionResult, AcquisitionTarget } from "@/types/media";

interface ImportMagnetModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: AcquisitionTarget | null;
}

// The three "a finished file is about to be destroyed" keys. A downloading
// target no longer conflicts at all (022-download-status-tags REQ-7), so
// there is no second, weaker key family to sit beside these.
const ALREADY_COMPLETED_KEYS = [
  "error.movie.already_completed",
  "error.episode.already_completed",
  "error.season.already_completed",
];

export default function ImportMagnetModal({
  isOpen,
  onClose,
  target,
}: ImportMagnetModalProps) {
  const t = useTranslations("import.magnet");
  const [magnet, setMagnet] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const router = useRouter();

  const isCompleted =
    target !== null &&
    (target.kind === "movie"
      ? target.movie.status === "COMPLETED"
      : target.episode.status === "COMPLETED");

  // Limpiar todo cuando cambia el target o se reabre el modal. A COMPLETED
  // target starts with the warning already shown and force already implied
  // — the user has read the warning before typing, no wasted round trip.
  useEffect(() => {
    if (isOpen) {
      setMagnet("");
      setError(null);
      setNeedsConfirm(isCompleted);
    }
  }, [isOpen, target, isCompleted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target || !magnet.trim()) return;

    setIsPending(true);
    setError(null);

    const force = isCompleted || needsConfirm;
    let result: AcquisitionResult;
    if (target.kind === "movie") {
      result = await importMagnetAction(Number(target.movie.id), magnet, force);
    } else {
      result = await addMagnetToEpisodeAction(
        Number(target.episode.id),
        magnet,
        force,
      );
    }

    if ("error" in result) {
      setError(result.error);
      setNeedsConfirm(
        !!result.errorKey && ALREADY_COMPLETED_KEYS.includes(result.errorKey),
      );
      setIsPending(false);
      return;
    }

    onClose();
    // Mismo criterio que ImportFileModal/SearchTorrent: refrescar el server
    // component para que la película aparezca con su estado nuevo.
    router.refresh();
    setIsPending(false);
  };

  if (!target) return null;

  const targetLabel =
    target.kind === "movie"
      ? target.movie.title
      : `${target.showTitle} S${String(target.seasonNumber).padStart(2, "0")}E${String(target.episode.episodeNumber).padStart(2, "0")}`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[700px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Magnet className="size-6 text-red-500" />
            {t("title")}
          </h4>
          <p className="mb-6 text-gray-500 dark:text-gray-400 lg:mb-7">
            {t.rich("description", {
              target: targetLabel,
              b: (chunks) => (
                <span className="font-medium text-gray-800 dark:text-white">
                  {chunks}
                </span>
              ),
            })}
          </p>
        </div>
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <div className="px-2 overflow-y-auto custom-scrollbar">
            {isCompleted && <ReplaceWarning target={targetLabel} />}
            <Label>{t("label")}</Label>
            <input
              type="text"
              value={magnet}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setMagnet(e.target.value);
                setError(null);
                setNeedsConfirm(isCompleted);
              }}
              placeholder={t("placeholder")}
              autoFocus
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />
            {error && <p className="mt-2 text-error-500">{error}</p>}
          </div>
          <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
            <Button size="sm" variant="outline" onClick={onClose} type="button">
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={isPending || !magnet.trim()}
            >
              {isPending
                ? t("processing")
                : needsConfirm
                  ? t("replace")
                  : t("confirm")}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
