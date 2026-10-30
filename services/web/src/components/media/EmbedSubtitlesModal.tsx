"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getLanguages } from "@/actions/languages";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import type { Language } from "@/types/languages";
import type {
  ExternalSubtitle,
  SubtitleEmbedInput,
  SubtitleEmbedResult,
} from "@/types/media";

interface EmbedSubtitlesModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: ExternalSubtitle[];
  onEmbed: (subtitles: SubtitleEmbedInput[]) => Promise<SubtitleEmbedResult>;
  onStale: (message: string) => void;
  onEmbedded: () => void;
}

interface RowState {
  include: boolean;
  languageIso3: string;
  isDefault: boolean;
  offset: string;
  autoOffset: boolean;
}

const OFFSET_LIMIT = 600000;
const ERROR_CLASS =
  "text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";
const INPUT_CLASS =
  "h-9 rounded-lg border border-gray-300 bg-transparent px-3 text-base text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";
const STALE_LISTING_KEY = "error.subtitleEmbed.stale_listing";

function parseOffset(raw: string): number | null {
  if (!/^-?\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Math.abs(value) <= OFFSET_LIMIT ? value : null;
}

function initialRows(subtitles: ExternalSubtitle[]): Record<string, RowState> {
  const rows: Record<string, RowState> = {};
  for (const subtitle of subtitles) {
    rows[subtitle.fileName] = {
      include: true,
      languageIso3: subtitle.languageIso3 ?? "",
      isDefault: false,
      offset: "0",
      autoOffset: true,
    };
  }
  return rows;
}

// Spec 101, REQ-5
function baseLanguages(languages: Language[]): Language[] {
  const byIso3 = new Map<string, Language>();
  for (const language of languages) {
    const known = byIso3.get(language.iso3);
    if (!known || (!language.tag.includes("-") && known.tag.includes("-"))) {
      byIso3.set(language.iso3, language);
    }
  }
  return [...byIso3.values()];
}

export default function EmbedSubtitlesModal({
  isOpen,
  onClose,
  subtitles,
  onEmbed,
  onStale,
  onEmbedded,
}: EmbedSubtitlesModalProps) {
  const t = useTranslations("media.embedSubtitles");
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    initialRows(subtitles),
  );
  const [languages, setLanguages] = useState<Language[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Reset the choices and re-read the languages every time the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    setRows(initialRows(subtitles));
    setError(null);
    let cancelled = false;
    getLanguages()
      .then((all) => {
        if (!cancelled) setLanguages(baseLanguages(all));
      })
      .catch(() => {
        if (!cancelled) setLanguages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, subtitles]);

  const knownIso3 = new Set(languages.map((language) => language.iso3));
  const rowFor = (fileName: string): RowState =>
    rows[fileName] ?? initialRows(subtitles)[fileName];

  const update = (fileName: string, patch: Partial<RowState>) => {
    setRows((prev) => ({
      ...prev,
      [fileName]: { ...rowFor(fileName), ...patch },
    }));
  };

  const setDefault = (fileName: string, checked: boolean) => {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const subtitle of subtitles) {
        const row = prev[subtitle.fileName] ?? rowFor(subtitle.fileName);
        next[subtitle.fileName] = {
          ...row,
          isDefault: subtitle.fileName === fileName ? checked : false,
        };
      }
      return next;
    });
  };

  const included = subtitles.filter((s) => rowFor(s.fileName).include);
  const valid =
    included.length > 0 &&
    included.every((s) => {
      const row = rowFor(s.fileName);
      return (
        knownIso3.has(row.languageIso3) &&
        (row.autoOffset || parseOffset(row.offset) !== null)
      );
    });

  const handleConfirm = async () => {
    const payload: SubtitleEmbedInput[] = [];
    for (const subtitle of included) {
      const row = rowFor(subtitle.fileName);
      const offsetMs = row.autoOffset ? 0 : parseOffset(row.offset);
      if (offsetMs === null) return;
      payload.push({
        fileName: subtitle.fileName,
        languageIso3: row.languageIso3,
        isDefault: row.isDefault,
        offsetMs,
        autoOffset: row.autoOffset,
      });
    }

    setIsPending(true);
    setError(null);
    try {
      const result = await onEmbed(payload);
      if ("error" in result) {
        if (result.errorKey === STALE_LISTING_KEY) {
          onStale(result.error);
          return;
        }
        setError(result.error);
        return;
      }
      onEmbedded();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[720px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90">
            {t("title")}
          </h4>
          <p className="mb-6 text-gray-600 dark:text-gray-300">{t("intro")}</p>
        </div>
        <div className="px-2 space-y-4">
          {error && (
            <p role="alert" className={ERROR_CLASS}>
              {error}
            </p>
          )}

          {subtitles.map((subtitle) => {
            const row = rowFor(subtitle.fileName);
            const offsetInvalid = parseOffset(row.offset) === null;
            return (
              <div
                key={subtitle.fileName}
                className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              >
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) =>
                      update(subtitle.fileName, {
                        include: e.target.checked,
                        isDefault: e.target.checked ? row.isDefault : false,
                      })
                    }
                    aria-label={t("include")}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block break-all font-medium text-gray-800 dark:text-white/90">
                      {subtitle.fileName}
                    </span>
                    <span className="block text-base text-gray-500 dark:text-gray-400">
                      {subtitle.title}
                      {subtitle.isForced && ` · ${t("forced")}`}
                    </span>
                  </span>
                </label>

                <div className="flex flex-wrap items-end gap-4">
                  <label className="space-y-1">
                    <span className="block text-base text-gray-600 dark:text-gray-300">
                      {t("language")}
                    </span>
                    <select
                      value={
                        knownIso3.has(row.languageIso3) ? row.languageIso3 : ""
                      }
                      disabled={!row.include}
                      onChange={(e) =>
                        update(subtitle.fileName, {
                          languageIso3: e.target.value,
                        })
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="">{t("languagePlaceholder")}</option>
                      {languages.map((language) => (
                        <option key={language.iso3} value={language.iso3}>
                          {language.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="block text-base text-gray-600 dark:text-gray-300">
                      {t("offset")}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={-OFFSET_LIMIT}
                      max={OFFSET_LIMIT}
                      value={row.offset}
                      disabled={!row.include || row.autoOffset}
                      onChange={(e) =>
                        update(subtitle.fileName, { offset: e.target.value })
                      }
                      aria-invalid={
                        row.include && !row.autoOffset && offsetInvalid
                      }
                      className={`${INPUT_CLASS} w-32`}
                    />
                  </label>

                  <label className="flex items-center gap-2 pb-2 text-base text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={row.autoOffset}
                      disabled={!row.include}
                      onChange={(e) =>
                        update(subtitle.fileName, {
                          autoOffset: e.target.checked,
                        })
                      }
                    />
                    {t("autoOffset")}
                  </label>

                  <label className="flex items-center gap-2 pb-2 text-base text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={row.isDefault}
                      disabled={!row.include}
                      onChange={(e) =>
                        setDefault(subtitle.fileName, e.target.checked)
                      }
                    />
                    {t("makeDefault")}
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
          <Button size="sm" variant="outline" onClick={onClose} type="button">
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={isPending || !valid}
            onClick={handleConfirm}
          >
            {isPending ? t("submitting") : t("confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
