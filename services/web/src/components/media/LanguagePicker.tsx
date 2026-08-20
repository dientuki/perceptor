"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useMemo } from "react";
import Button from "@/components/ui/button/Button";
import type { Language } from "@/types/languages";

type LanguagePickerAction = (
  prevState: unknown,
  formData: FormData,
) => Promise<{ error?: string } | { success: true }>;

interface LanguagePickerProps {
  // All languages available to pick from — always sourced from the
  // `languages` query, never hard-coded (see docs/spec/graphql-contract.md).
  options: Language[];
  // The calling user's own current selection for this scope (global or
  // per-title) — never the merged set across owners.
  selected: Language[];
  // Bound per call site: setPreferredLanguagesAction for the global card,
  // or setMoviePreferredLanguagesAction/setShowPreferredLanguagesAction
  // (already bound to the title's id) for the per-title pickers.
  action: LanguagePickerAction;
  label?: string;
}

export default function LanguagePicker({
  options,
  selected,
  action,
  label,
}: LanguagePickerProps) {
  const t = useTranslations("media.languagePicker");
  const activeLocale = useLocale();
  const resolvedLabel = label ?? t("defaultLabel");
  const [state, formAction, isPending] = useActionState(action, null);

  const selectedIso2 = selected.map((language) => language.iso2);

  // Language names are rendered for the active locale via the platform's
  // Intl.DisplayNames rather than trusting api's `name` field (English-only
  // since 018-ui-i18n moved display authority to web) or api's sort order.
  const displayNames = useMemo(
    () => new Intl.DisplayNames([activeLocale], { type: "language" }),
    [activeLocale],
  );
  const displayName = (option: Language) =>
    displayNames.of(option.iso2) ?? option.name;
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

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <label
          htmlFor="language-picker-select"
          className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
        >
          {resolvedLabel}
        </label>
        <select
          id="language-picker-select"
          name="iso2"
          multiple
          defaultValue={selectedIso2}
          className="h-40 w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm text-gray-800 shadow-theme-xs focus:outline-hidden dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        >
          {sortedOptions.map((option) => (
            <option key={option.id} value={option.iso2}>
              {displayName(option)}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-gray-500">{t("helpText")}</p>
      </div>

      {state && "error" in state && state.error && (
        <p className="text-sm text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg">
          {state.error}
        </p>
      )}

      {state && "success" in state && state.success && (
        <p className="text-sm text-success-500">{t("saved")}</p>
      )}

      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
