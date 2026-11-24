"use client";

import { useTranslations } from "next-intl";
import { type ErrorTranslator, translateErrorKey } from "@/lib/graphql-error";
import type { SubtitleEmbed } from "@/types/media";

interface SubtitleEmbedOutcomeProps {
  embed: SubtitleEmbed | null | undefined;
}

// Spec 124, REQ-15
export default function SubtitleEmbedOutcome({
  embed,
}: SubtitleEmbedOutcomeProps) {
  const t = useTranslations("media.embedSubtitles");
  const tErrors = useTranslations("errors");

  if (!embed) return null;
  const fallback = tErrors("network.connectionFailed");
  const reasonOf = (key: string | null | undefined) =>
    translateErrorKey(
      tErrors as ErrorTranslator,
      key ?? undefined,
      undefined,
      fallback,
    );

  if (embed.status === "FAILED") {
    return (
      <p role="alert" className="w-full text-base text-error-500">
        {t("failed", { reason: reasonOf(embed.errorKey) })}
      </p>
    );
  }
  if (embed.status === "COMPLETED" && embed.warningKey) {
    return (
      <p className="w-full text-base text-warning-500">
        {t("warning", { reason: reasonOf(embed.warningKey) })}
      </p>
    );
  }
  return null;
}
