"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import { SUPPORTED_LOCALES } from "@/i18n/locales";

interface GeneralPanelProps {
  uiLocale: string;
}

// The installation's default UI language (REQ-2, General tab). Options are
// SUPPORTED_LOCALES — the one list every locale consumer reads — never a
// hardcoded pair. Names are rendered through Intl.DisplayNames for the
// active locale, the same display-authority pattern LanguagePicker uses.
export default function GeneralPanel({ uiLocale }: GeneralPanelProps) {
  const t = useTranslations("settings.general");
  const activeLocale = useLocale();

  const displayNames = useMemo(
    () => new Intl.DisplayNames([activeLocale], { type: "language" }),
    [activeLocale],
  );

  const options = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: displayNames.of(locale) ?? locale,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="ui_locale">{t("uiLocaleLabel")}</Label>
        <Select
          id="ui_locale"
          name="ui_locale"
          defaultValue={uiLocale}
          options={options}
        />
      </div>
    </div>
  );
}
