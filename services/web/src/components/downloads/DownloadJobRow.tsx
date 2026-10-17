"use client";

import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { startEncodeJobAction, stopEncodeJobAction } from "@/actions/downloads";
import StatusBadge from "@/components/status/StatusBadge";
import Button from "@/components/ui/button/Button";
import { formatEncodeSpeed } from "@/lib/format";
import type { DownloadJob } from "@/types/downloads";
import DiscardJobModal from "./DiscardJobModal";
import DownloadErrorLine from "./DownloadErrorLine";
import DownloadProgressBar from "./DownloadProgressBar";

const REFRESH_ON_KEYS = [
  "error.download.retry_replaced",
  "error.download.retry_superseded",
  "error.processJob.not_resumable",
  "error.processJob.not_running",
];

const DISCARDABLE = ["QUEUED", "ENCODING", "ERROR", "PAUSED"];

interface DownloadJobRowProps {
  job: DownloadJob;
  // Spec 095, REQ-20
  canAct: boolean;
}

export default function DownloadJobRow({ job, canAct }: DownloadJobRowProps) {
  const t = useTranslations("downloads.panel");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);

  const isDiscarded = job.status === "DISCARDED";
  const isPaused = job.status === "PAUSED";
  const canRetry =
    canAct && ((job.status === "ERROR" && job.retryable) || isPaused);
  const canPause = canAct && ["QUEUED", "ENCODING"].includes(job.status);
  const canDiscard = canAct && DISCARDABLE.includes(job.status);

  const handleRetry = () => {
    setRowError(null);
    startTransition(async () => {
      const result = await startEncodeJobAction(job.processJobId);
      if ("error" in result) {
        setRowError(result.error || t("retryErrorDefault"));
        if (result.errorKey && REFRESH_ON_KEYS.includes(result.errorKey)) {
          router.refresh();
        }
        return;
      }
      router.refresh();
    });
  };

  const handlePause = () => {
    setRowError(null);
    startTransition(async () => {
      const result = await stopEncodeJobAction(job.processJobId);
      if ("error" in result) {
        setRowError(result.error || t("pauseErrorDefault"));
        if (result.errorKey && REFRESH_ON_KEYS.includes(result.errorKey)) {
          router.refresh();
        }
        return;
      }
      router.refresh();
    });
  };

  return (
    <tr className="bg-gray-50/50 dark:bg-white/[0.02]">
      <td className="py-2 pr-4 pl-10 text-gray-700 dark:text-gray-300">
        <span
          className={
            isDiscarded ? "text-gray-400 line-through dark:text-gray-500" : ""
          }
        >
          {job.label}
        </span>
        {job.status === "ERROR" && job.lastError && (
          <DownloadErrorLine error={job.lastError} />
        )}
        {rowError && (
          <div className="mt-1 text-base text-error-500">{rowError}</div>
        )}
      </td>
      <td className="px-4 py-2">
        <StatusBadge status={job.status} />
      </td>
      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
        {!isDiscarded && <DownloadProgressBar progress={job.progress} />}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-gray-700 dark:text-gray-300">
        {job.status === "ENCODING" ? formatEncodeSpeed(job.encodeSpeed) : null}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          {canPause && (
            <Button
              size="sm"
              variant="outline"
              title={t("pauseJobTitle")}
              disabled={isPending}
              onClick={handlePause}
            >
              <Pause size={16} />
            </Button>
          )}
          {canRetry && (
            <Button
              size="sm"
              variant="outline"
              title={isPaused ? t("resumeJobTitle") : t("retryJobTitle")}
              disabled={isPending}
              onClick={handleRetry}
            >
              {isPaused ? <Play size={16} /> : <RotateCcw size={16} />}
            </Button>
          )}
          {canDiscard && (
            <Button
              size="sm"
              variant="outline"
              title={t("discardJobTitle")}
              disabled={isPending}
              onClick={() => setIsDiscardOpen(true)}
            >
              <X size={16} className="text-error-500" />
            </Button>
          )}
        </div>
        {canDiscard && (
          <DiscardJobModal
            isOpen={isDiscardOpen}
            onClose={() => setIsDiscardOpen(false)}
            job={job}
          />
        )}
      </td>
    </tr>
  );
}
