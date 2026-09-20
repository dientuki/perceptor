"use client";

import { useTranslations } from "next-intl";
import { translateErrorKey } from "@/lib/graphql-error";
import type { DownloadError } from "@/types/downloads";

interface DownloadErrorLineProps {
  error: DownloadError;
}

const KNOWN_STAGES = ["DOWNLOAD", "SCAN", "ENCODE", "REPLACED"];

function parseParams(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export default function DownloadErrorLine({ error }: DownloadErrorLineProps) {
  const t = useTranslations("downloads.panel");
  const tErrors = useTranslations("errors");

  const message = translateErrorKey(
    tErrors,
    error.key,
    parseParams(error.params),
    error.message,
  );
  const stageLabel = KNOWN_STAGES.includes(error.stage)
    ? t(`stage.${error.stage}`)
    : null;

  return (
    <div className="mt-1 text-xs text-error-500">
      {stageLabel && <span className="font-medium">{stageLabel}: </span>}
      {message}
    </div>
  );
}
