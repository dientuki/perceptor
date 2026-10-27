"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import Input from "@/components/form/input/InputField";
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
  openSubtitlesUsername: string;
  openSubtitlesPassword: string;
}

// Spec 029, REQ-2
export default function GeneralPanel({
  uiLocale,
  dateMonthFirst,
  openSubtitlesUsername,
  openSubtitlesPassword,
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
      <div className="space-y-4">
        <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
          {t("openSubtitlesHeading")}
        </h3>
        <div>
          <Label htmlFor="opensubtitles_username">
            {t("openSubtitlesUsernameLabel")}
          </Label>
          <Input
            id="opensubtitles_username"
            name="opensubtitles_username"
            type="text"
            autoComplete="off"
            defaultValue={openSubtitlesUsername}
          />
        </div>
        <div>
          <Label htmlFor="opensubtitles_password">
            {t("openSubtitlesPasswordLabel")}
          </Label>
          <Input
            id="opensubtitles_password"
            name="opensubtitles_password"
            type="password"
            autoComplete="new-password"
            defaultValue={openSubtitlesPassword}
          />
        </div>
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          {t("openSubtitlesHelp")}{" "}
          <a
            href="https://www.opensubtitles.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-500 hover:underline"
          >
            {t("openSubtitlesSignUp")}
          </a>
        </p>
      </div>
    </div>
  );
}
