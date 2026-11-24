"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import {
  isSupportedLocale,
  MONTH_FIRST_BY_LOCALE,
  SUPPORTED_LOCALES,
} from "@/i18n/locales";

interface GeneralPanelProps {
  uiLocale: string;
  dateMonthFirst: string;
}

// Spec 029, REQ-2
export default function GeneralPanel({
  uiLocale,
  dateMonthFirst,
}: GeneralPanelProps) {
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

  const dateOptions = [
    { value: "false", label: "DD/MM/YYYY" },
    { value: "true", label: "MM/DD/YYYY" },
  ];
  const dateDefault =
    dateMonthFirst === "true" || dateMonthFirst === "false"
      ? dateMonthFirst
      : String(
          isSupportedLocale(activeLocale)
            ? MONTH_FIRST_BY_LOCALE[activeLocale]
            : false,
        );

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
      <div>
        <Label htmlFor="date_month_first">{t("dateFormatLabel")}</Label>
        <Select
          id="date_month_first"
          name="date_month_first"
          defaultValue={dateDefault}
          options={dateOptions}
        />
      </div>
    </div>
  );
}
