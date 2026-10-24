"use client";

import { useLocale, useTranslations } from "next-intl";
import { useDateMonthFirst } from "@/context/DateFormatContext";
import { formatDateTime } from "@/lib/format";
import { type ErrorTranslator, translateErrorKey } from "@/lib/graphql-error";
import { type StatusTone, statusTone } from "@/lib/status-tone";
import type {
  SubtitleSearch,
  SubtitleSearchLanguageOutcome,
  SubtitleSearchStatus as SubtitleSearchStatusValue,
} from "@/types/media";

const STATUS_TO_BADGE_STATUS: Record<SubtitleSearchStatusValue, string> = {
  WAITING: "QUEUED",
  SEARCHING: "DOWNLOADING",
  VALIDATING: "DOWNLOADING",
  EMBEDDING: "DOWNLOADING",
  COMPLETED: "COMPLETED",
  FAILED: "ERROR",
};

const TONE_CLASS: Record<StatusTone, string> = {
  completed: "bg-green-500/10 text-green-500",
  error: "bg-red-500/10 text-red-500",
  missing: "bg-gray-100 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400",
  progress: "animate-pulse bg-blue-500/10 text-blue-500",
};

const OUTCOME_TEXT_CLASS: Partial<
  Record<SubtitleSearchLanguageOutcome, string>
> = {
  EMBEDDED: "text-green-500",
  FAILED: "text-error-500",
  REJECTED: "text-error-500",
};

// Spec 103, REQ-13 REQ-14
export default function SubtitleSearchStatus({
  search,
}: {
  search: SubtitleSearch;
}) {
  const t = useTranslations("media.subtitleSearch");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const monthFirst = useDateMonthFirst();

  const fallback = tErrors("network.connectionFailed");
  const reasonOf = (key: string | null) =>
    translateErrorKey(
      tErrors as ErrorTranslator,
      key ?? undefined,
      undefined,
      fallback,
    );
  const label = (group: "status" | "outcome", value: string) =>
    t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value;
  const languageName = (iso3: string) => {
    try {
      return (
        new Intl.DisplayNames([locale], { type: "language" }).of(iso3) ?? iso3
      );
    } catch {
      return iso3;
    }
  };

  const tone = statusTone(STATUS_TO_BADGE_STATUS[search.status] ?? "");

  return (
    <div className="space-y-1 text-base">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-gray-500 dark:text-gray-400">{t("title")}</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-theme-sm font-bold uppercase tracking-wider ${TONE_CLASS[tone]}`}
        >
          {label("status", search.status)}
        </span>
        {search.finishedAt && (
          <span className="text-gray-500 dark:text-gray-400">
            {t("finishedAt", {
              date: formatDateTime(search.finishedAt, monthFirst),
            })}
          </span>
        )}
      </div>
      {search.status === "FAILED" && (
        <p role="alert" className="text-error-500">
          {t("failed", { reason: reasonOf(search.errorKey) })}
        </p>
      )}
      {search.languages.length > 0 && (
        <ul className="space-y-0.5">
          {search.languages.map((language) => (
            <li
              key={language.languageIso3}
              className={
                OUTCOME_TEXT_CLASS[language.outcome] ??
                "text-gray-700 dark:text-gray-300"
              }
            >
              {language.reasonKey
                ? t("languageLineReason", {
                    language: languageName(language.languageIso3),
                    outcome: label("outcome", language.outcome),
                    reason: reasonOf(language.reasonKey),
                  })
                : t("languageLine", {
                    language: languageName(language.languageIso3),
                    outcome: label("outcome", language.outcome),
                  })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
