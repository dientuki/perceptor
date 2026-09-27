"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { useMemo } from "react";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type { EffectiveLanguages } from "@/lib/effective-languages";
import type { Language } from "@/types/languages";
import TitleLanguagesModal from "./TitleLanguagesModal";

type ModalProps = ComponentProps<typeof TitleLanguagesModal>;

interface TitleLanguagesPanelProps
  extends Omit<ModalProps, "isOpen" | "onClose" | "onSaved"> {
  effective: EffectiveLanguages;
}

export default function TitleLanguagesPanel({
  effective,
  ...formProps
}: TitleLanguagesPanelProps) {
  const t = useTranslations("media.languagesPanel");
  const locale = useLocale();
  const router = useRouter();
  const { isOpen, openModal, closeModal } = useModal();

  const displayNames = useMemo(
    () => new Intl.DisplayNames([locale], { type: "language" }),
    [locale],
  );
  const names = (languages: Language[]) =>
    languages
      .map((language) => displayNames.of(language.tag) ?? language.tag)
      .join(", ");

  return (
    <div className="space-y-3">
      <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90">
        {t("title")}
      </h4>
      <dl className="space-y-2 text-gray-700 dark:text-gray-300">
        <div>
          <dt className="font-medium">
            {t("audioLabel")}
            {effective.audioInherited && (
              <span className="ml-2 text-gray-500 dark:text-gray-400">
                {t("inheritedNote")}
              </span>
            )}
          </dt>
          <dd>
            {effective.audioLanguages.length > 0
              ? names(effective.audioLanguages)
              : t("empty")}
          </dd>
          <dd className="text-gray-500 dark:text-gray-400">
            {effective.audioMandatory ? t("mandatoryYes") : t("mandatoryNo")}
          </dd>
        </div>
        <div>
          <dt className="font-medium">
            {t("subtitlesLabel")}
            {effective.subtitlesInherited && (
              <span className="ml-2 text-gray-500 dark:text-gray-400">
                {t("inheritedNote")}
              </span>
            )}
          </dt>
          <dd>
            {effective.subtitleLanguages.length > 0
              ? names(effective.subtitleLanguages)
              : t("empty")}
          </dd>
        </div>
      </dl>
      <Button size="sm" variant="outline" onClick={openModal}>
        {t("changeButton")}
      </Button>
      <TitleLanguagesModal
        {...formProps}
        isOpen={isOpen}
        onClose={closeModal}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
