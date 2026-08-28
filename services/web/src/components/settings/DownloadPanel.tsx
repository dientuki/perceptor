"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { updateDefaultLanguagesAction } from "@/actions/settings";
import LanguagePicker from "@/components/media/LanguagePicker";
import type { Language } from "@/types/languages";

interface DownloadPanelProps {
  options: Language[];
  defaultSelectedTags: string[];
}

// Descarga tab (REQ-6): the installation's default download languages, now
// through the shared LanguagePicker rather than a MultiSelect + hidden-input
// pair. LanguagePicker owns its own <form> and save action, so this panel
// submits independently of SettingsForm's main form — see
// updateDefaultLanguagesAction in src/actions/settings.ts for why.
export default function DownloadPanel({
  options,
  defaultSelectedTags,
}: DownloadPanelProps) {
  const t = useTranslations("settings.download");

  const selected = useMemo(
    () =>
      defaultSelectedTags
        .map((tag) => options.find((option) => option.tag === tag))
        .filter((language): language is Language => language != null),
    [options, defaultSelectedTags],
  );

  return (
    <LanguagePicker
      options={options}
      selected={selected}
      action={updateDefaultLanguagesAction}
      label={t("defaultLanguagesLabel")}
      name="default_languages"
    />
  );
}
