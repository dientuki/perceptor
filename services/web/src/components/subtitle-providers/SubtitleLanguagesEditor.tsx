"use client";

import { Plus, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { setSubtitleProviderLanguagesAction } from "@/actions/subtitle-providers";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import Button from "@/components/ui/button/Button";
import type { Language } from "@/types/languages";
import type {
  SubtitleProvider,
  SubtitleProviderKind,
  SubtitleProviderLanguage,
  SubtitleProviderSettings,
} from "@/types/subtitle-providers";

interface SubtitleLanguagesEditorProps {
  settings: SubtitleProviderSettings;
  languages: Language[];
  onSaved: (settings: SubtitleProviderSettings) => void;
}

function serves(provider: SubtitleProvider | undefined, language: Language) {
  if (!provider || provider.languageTags === null) return true;

  return provider.languageTags.some(
    (tag) =>
      tag === language.tag ||
      tag === language.iso2 ||
      tag === language.iso3 ||
      tag === language.tag.split("-")[0],
  );
}

// Spec 121, REQ-5 REQ-6
export default function SubtitleLanguagesEditor({
  settings,
  languages,
  onSaved,
}: SubtitleLanguagesEditorProps) {
  const t = useTranslations("subtitleProviders");
  const locale = useLocale();
  const configured = settings.providers.filter((p) => p.configured);
  const [defaultProvider, setDefaultProvider] = useState<SubtitleProviderKind>(
    configured.find((p) => p.isDefault)?.kind ??
      configured[0]?.kind ??
      "OPENSUBTITLES",
  );
  const [entries, setEntries] = useState<SubtitleProviderLanguage[]>(
    settings.languages,
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const displayNames = useMemo(
    () => new Intl.DisplayNames([locale], { type: "language" }),
    [locale],
  );
  const labelOf = (language: Language) => {
    let name: string | undefined;
    try {
      name = displayNames.of(language.tag);
    } catch {
      name = undefined;
    }

    return `${name ?? language.name} (${language.tag})`;
  };

  const providerOf = (kind: SubtitleProviderKind) =>
    settings.providers.find((p) => p.kind === kind);
  const providerOptions = configured
    .filter((p) => p.kind !== defaultProvider)
    .map((p) => ({ value: p.kind, label: t(`name.${p.kind}`) }));
  const usedTags = new Set(entries.map((r) => r.languageTag));

  const update = (index: number, patch: Partial<SubtitleProviderLanguage>) => {
    setEntries((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    setSaved(false);
  };

  const tagOptionsFor = (row: SubtitleProviderLanguage) => {
    const provider = providerOf(row.provider);
    const options = languages
      .filter(
        (language) =>
          language.tag === row.languageTag ||
          (serves(provider, language) && !usedTags.has(language.tag)),
      )
      .map((language) => ({ value: language.tag, label: labelOf(language) }));

    // A tag the catalog no longer lists stays visible so the refusal is explainable.
    if (!options.some((o) => o.value === row.languageTag)) {
      options.unshift({ value: row.languageTag, label: row.languageTag });
    }

    return options;
  };

  const handleAdd = () => {
    const provider = providerOptions[0]?.value as
      | SubtitleProviderKind
      | undefined;
    const target = providerOf(provider as SubtitleProviderKind);
    const language = languages.find(
      (l) => !usedTags.has(l.tag) && serves(target, l),
    );

    if (!provider || !language) return;

    setEntries((prev) => [...prev, { languageTag: language.tag, provider }]);
    setSaved(false);
  };

  const handleSave = async () => {
    setIsPending(true);
    setError(null);
    setSaved(false);

    try {
      const result = await setSubtitleProviderLanguagesAction(
        defaultProvider,
        entries,
      );

      if ("error" in result) {
        setError(result.error);
        return;
      }

      onSaved(result.settings);
      setSaved(true);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
          {t("languages.title")}
        </h3>
        <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
          {t("languages.description")}
        </p>
      </div>

      <div>
        <Label htmlFor="subtitle_provider_default">
          {t("languages.defaultLabel")}
        </Label>
        <Select
          id="subtitle_provider_default"
          value={defaultProvider}
          options={configured.map((p) => ({
            value: p.kind,
            label: t(`name.${p.kind}`),
          }))}
          onChange={(e) => {
            setDefaultProvider(e.target.value as SubtitleProviderKind);
            setSaved(false);
          }}
        />
      </div>

      {entries.length === 0 ? (
        <p className="text-base text-gray-500 dark:text-gray-400">
          {t("languages.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {entries.map((row, index) => (
            <li
              key={row.languageTag}
              className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <div>
                <Label htmlFor={`subtitle_language_tag_${index}`}>
                  {t("languages.languageLabel")}
                </Label>
                <Select
                  id={`subtitle_language_tag_${index}`}
                  value={row.languageTag}
                  options={tagOptionsFor(row)}
                  onChange={(e) =>
                    update(index, { languageTag: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`subtitle_language_provider_${index}`}>
                  {t("languages.providerLabel")}
                </Label>
                <Select
                  id={`subtitle_language_provider_${index}`}
                  value={row.provider}
                  options={configured.map((p) => ({
                    value: p.kind,
                    label: t(`name.${p.kind}`),
                  }))}
                  onChange={(e) =>
                    update(index, {
                      provider: e.target.value as SubtitleProviderKind,
                    })
                  }
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                ariaLabel={t("languages.removeRow")}
                title={t("languages.removeRow")}
                onClick={() => {
                  setEntries((prev) => prev.filter((_, i) => i !== index));
                  setSaved(false);
                }}
              >
                <X size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg">
          {error}
        </p>
      )}
      {saved && <p className="text-success-500">{t("languages.saved")}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          startIcon={<Plus size={16} />}
          disabled={providerOptions.length === 0}
          onClick={handleAdd}
        >
          {t("languages.add")}
        </Button>
        <Button size="sm" disabled={isPending} onClick={handleSave}>
          {isPending ? t("languages.saving") : t("languages.save")}
        </Button>
      </div>
    </div>
  );
}
