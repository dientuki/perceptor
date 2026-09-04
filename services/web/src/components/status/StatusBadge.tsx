"use client";

import { useTranslations } from "next-intl";

// The one status pill (REQ-10). Replaces the byte-identical
// `statusBadgeClass` duplicates that used to live in
// `downloads/DownloadsPanel.tsx` and `shows/SeasonAccordion.tsx`.
function statusBadgeClass(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "bg-green-500/10 text-green-500";
    case "ERROR":
      return "bg-red-500/10 text-red-500";
    case "MISSING":
      return "bg-gray-100 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400";
    default:
      return "animate-pulse bg-blue-500/10 text-blue-500";
  }
}

// Maps a normalized status value to its translated label. An unrecognised
// value renders as-is rather than throwing on a missing catalog key or
// rendering an empty pill — `api` should never send one, and a blank badge
// would hide the fact if it did.
function statusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case "MISSING":
      return t("missing");
    case "QUEUED":
      return t("queued");
    case "DOWNLOADING":
      return t("downloading");
    case "PAUSED":
      return t("paused");
    case "DOWNLOADED":
      return t("downloaded");
    case "ENCODING":
      return t("encoding");
    case "COMPLETED":
      return t("completed");
    case "ERROR":
      return t("error");
    default:
      return status;
  }
}

export default function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("status");

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-bold uppercase tracking-wider ${statusBadgeClass(
        status,
      )}`}
    >
      {statusLabel(status, t)}
    </span>
  );
}
