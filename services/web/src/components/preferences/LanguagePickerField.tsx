"use client";

import { Check, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import Badge from "@/components/ui/badge/Badge";
import type { Language } from "@/types/languages";

interface LanguagePickerFieldProps {
  options: Language[];
  value: string[];
  onChange: (tags: string[]) => void;
  label: string;
  disabled?: boolean;
}

interface LanguageGroup {
  iso2: string;
  baseName: string;
  rows: Language[];
}

// Controlled sibling of components/media/LanguagePicker.tsx — same
// pick-and-badge visual, but no <form>, no action and no save button of its
// own, because REQ-8's single Guardar button owns the submit here rather
// than each field.
export default function LanguagePickerField({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: LanguagePickerFieldProps) {
  const t = useTranslations("media.languagePicker");
  const activeLocale = useLocale();

  const displayNames = useMemo(
    () => new Intl.DisplayNames([activeLocale], { type: "language" }),
    [activeLocale],
  );
  const displayName = (option: Language) =>
    displayNames.of(option.tag) ?? option.name;

  const groups = useMemo<LanguageGroup[]>(() => {
    const byIso2 = new Map<string, Language[]>();
    for (const option of options) {
      const bucket = byIso2.get(option.iso2);
      if (bucket) {
        bucket.push(option);
      } else {
        byIso2.set(option.iso2, [option]);
      }
    }

    const rowDisplayName = (option: Language) =>
      displayNames.of(option.tag) ?? option.name;

    const built = Array.from(byIso2.entries()).map(([iso2, rows]) => ({
      iso2,
      baseName: displayNames.of(iso2) ?? rows[0].name,
      rows: [...rows].sort((a, b) =>
        rowDisplayName(a).localeCompare(rowDisplayName(b), activeLocale),
      ),
    }));

    return built.sort((a, b) =>
      a.baseName.localeCompare(b.baseName, activeLocale),
    );
  }, [options, activeLocale, displayNames]);

  const languageByTag = useMemo(() => {
    const map = new Map<string, Language>();
    for (const option of options) {
      map.set(option.tag, option);
    }
    return map;
  }, [options]);

  const chosen = value
    .map((tag) => languageByTag.get(tag))
    .filter((language): language is Language => language != null);

  const toggle = (tag: string) => {
    if (disabled) return;
    onChange(
      value.includes(tag)
        ? value.filter((existing) => existing !== tag)
        : [...value, tag],
    );
  };

  const remove = (tag: string) => {
    if (disabled) return;
    onChange(value.filter((existing) => existing !== tag));
  };

  return (
    <div>
      <div className="mb-1.5 block font-medium text-gray-700 dark:text-gray-400">
        {label}
      </div>

      <div className="max-h-52 w-full overflow-y-auto rounded-lg border border-gray-300 bg-transparent p-2 shadow-theme-xs dark:border-gray-700 dark:bg-gray-900">
        {groups.length === 0 && (
          <p className="p-2 text-gray-500">{t("empty")}</p>
        )}
        {groups.map((group) => (
          <div key={group.iso2} className="mb-1 last:mb-0">
            {group.rows.length > 1 && (
              <div className="px-2 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {group.baseName}
              </div>
            )}
            <div
              className={
                group.rows.length > 1 ? "space-y-0.5 pl-2" : "space-y-0.5"
              }
            >
              {group.rows.map((row) => {
                const isSelected = value.includes(row.tag);
                return (
                  <button
                    key={row.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => toggle(row.tag)}
                    disabled={disabled}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                      isSelected
                        ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                    }`}
                  >
                    <span>{displayName(row)}</span>
                    {isSelected && <Check size={16} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="mb-1.5 block text-gray-700 dark:text-gray-400">
          {t("chosenLabel")}
        </div>
        {chosen.length === 0 ? (
          <p className="text-gray-500">{t("emptyChosen")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {chosen.map((language) => (
              <Badge
                key={language.id}
                color="primary"
                endIcon={
                  <button
                    type="button"
                    aria-label={t("removeLanguage", {
                      name: displayName(language),
                    })}
                    onClick={() => remove(language.tag)}
                    className="inline-flex"
                  >
                    <X size={14} />
                  </button>
                }
              >
                {displayName(language)}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
