"use client";

import { Check, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useMemo, useState } from "react";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import type { Language } from "@/types/languages";

type LanguagePickerAction = (
  prevState: unknown,
  formData: FormData,
) => Promise<{ error?: string } | { success: true }>;

interface LanguagePickerProps {
  // All languages available to pick from — always sourced from the
  // `languages` query, never hard-coded (see docs/spec/graphql-contract.md).
  // api already filters this down to the pickable catalog: a base row is
  // omitted whenever variant rows of it exist.
  options: Language[];
  // The calling user's own current selection for this scope (global default
  // or per-title) — never the merged set across owners.
  selected: Language[];
  // Bound per call site: setMoviePreferredLanguagesAction/
  // setShowPreferredLanguagesAction (already bound to the title's id) for
  // the per-title pickers, or updateSettingsAction's languages branch for
  // the installation default.
  action: LanguagePickerAction;
  label?: string;
  // Name of the single hidden input this component emits. Defaults to
  // "tags" (the per-title mutations' argument); Settings passes
  // "default_languages" explicitly.
  name?: string;
}

// A group of rows sharing one `iso2`. A group of exactly one row is a plain
// selectable entry; a group of more than one is a non-selectable heading
// (the base language's name) with its rows as entries beneath it. This is
// derived purely from the data — never a hard-coded list of which
// languages carry regional variants (REQ-4).
interface LanguageGroup {
  iso2: string;
  baseName: string;
  rows: Language[];
}

export default function LanguagePicker({
  options,
  selected,
  action,
  label,
  name = "tags",
}: LanguagePickerProps) {
  const t = useTranslations("media.languagePicker");
  const activeLocale = useLocale();
  const resolvedLabel = label ?? t("defaultLabel");
  const [state, formAction, isPending] = useActionState(action, null);

  // One state value backs both panes (REQ-5): the set of chosen tags. The
  // left pane's ticked entries and the right pane's badges both read off
  // it, so removing a badge and unticking an entry are the same operation.
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    selected.map((language) => language.tag),
  );

  // Language names are rendered for the active locale via the platform's
  // Intl.DisplayNames rather than trusting api's `name` field (English-only
  // since 018-ui-i18n moved display authority to web) or api's sort order.
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

    // Sorted by the BASE language's name so a whole group stays contiguous
    // — sorting each row by its own name would scatter "European Spanish"
    // and "Latin American Spanish" apart under "E" and "L" in English.
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

  const chosen = selectedTags
    .map((tag) => languageByTag.get(tag))
    .filter((language): language is Language => language != null);

  const toggle = (tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((existing) => existing !== tag)
        : [...current, tag],
    );
  };

  const remove = (tag: string) => {
    setSelectedTags((current) =>
      current.filter((existing) => existing !== tag),
    );
  };

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <div className="mb-1.5 block font-medium text-gray-700 dark:text-gray-400">
          {resolvedLabel}
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
                  const isSelected = selectedTags.includes(row.tag);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggle(row.tag)}
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

        <input type="hidden" name={name} value={selectedTags.join(",")} />
      </div>

      {state && "error" in state && state.error && (
        <p className="text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg">
          {state.error}
        </p>
      )}

      {state && "success" in state && state.success && (
        <p className="text-success-500">{t("saved")}</p>
      )}

      <div>
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
