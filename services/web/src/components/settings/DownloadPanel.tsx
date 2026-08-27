"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import MultiSelect from "@/components/form/MultiSelect";
import type { Language } from "@/types/languages";

interface DownloadPanelProps {
  options: Language[];
  defaultSelectedIso2: string[];
}

// Descarga tab (REQ-2): the installation's default download languages.
// MultiSelect is controlled and renders no `name`d input a <form> can read,
// so it needs the same hidden-input idiom PathPicker uses — one
// <input type="hidden" name="default_languages"> beside it, comma-joined,
// in the order the user picked them (AC-3). Options are built through
// Intl.DisplayNames + localeCompare for the active locale, exactly like
// LanguagePicker.tsx — api's `languages` query returns English names only,
// display authority lives in `web`.
export default function DownloadPanel({
  options,
  defaultSelectedIso2,
}: DownloadPanelProps) {
  const t = useTranslations("settings.download");
  const activeLocale = useLocale();
  const [selected, setSelected] = useState<string[]>(defaultSelectedIso2);

  const displayNames = useMemo(
    () => new Intl.DisplayNames([activeLocale], { type: "language" }),
    [activeLocale],
  );

  const sortedOptions = useMemo(
    () =>
      [...options].sort((a, b) =>
        (displayNames.of(a.iso2) ?? a.name).localeCompare(
          displayNames.of(b.iso2) ?? b.name,
          activeLocale,
        ),
      ),
    [options, activeLocale, displayNames],
  );

  const selectOptions = sortedOptions.map((option) => ({
    value: option.iso2,
    text: displayNames.of(option.iso2) ?? option.name,
    selected: selected.includes(option.iso2),
  }));

  return (
    <div className="space-y-6">
      <MultiSelect
        label={t("defaultLanguagesLabel")}
        options={selectOptions}
        defaultSelected={defaultSelectedIso2}
        onChange={setSelected}
      />
      <input
        type="hidden"
        name="default_languages"
        value={selected.join(",")}
      />
    </div>
  );
}
