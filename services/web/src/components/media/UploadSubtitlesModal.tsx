"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { getLanguages } from "@/actions/languages";
import { OFFSET_LIMIT, parseOffset } from "@/components/media/subtitle-offset";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { presetFromFileName } from "@/lib/subtitle-file-name";
import type { Language } from "@/types/languages";
import type { SubtitleEmbedResult, SubtitleUploadInput } from "@/types/media";

interface UploadSubtitlesModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileSubtitleLanguages: string[] | null | undefined;
  onUpload: (subtitles: SubtitleUploadInput[]) => Promise<SubtitleEmbedResult>;
  onStale: (message: string) => void;
  onUploaded: () => void;
}

interface UploadRow {
  file: File;
  languageTag: string;
  isForced: boolean;
  isDefault: boolean;
  replace: boolean;
  offset: string;
  autoOffset: boolean;
  preError: string | null;
}

const MAX_FILES = 8;
const MAX_BYTES = 2 * 1024 * 1024;
const STALE_KEYS = [
  "error.subtitleEmbed.busy",
  "error.subtitleSearch.in_progress",
];
const ERROR_CLASS =
  "text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";
const INPUT_CLASS =
  "h-9 rounded-lg border border-gray-300 bg-transparent px-3 text-base text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

// Spec 124, REQ-4
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function UploadSubtitlesModal({
  isOpen,
  onClose,
  fileSubtitleLanguages,
  onUpload,
  onStale,
  onUploaded,
}: UploadSubtitlesModalProps) {
  const t = useTranslations("media.uploadSubtitles");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setRows([]);
    setNotice(null);
    setError(null);
    let cancelled = false;
    getLanguages()
      .then((all) => {
        if (!cancelled) setLanguages(all);
      })
      .catch(() => {
        if (!cancelled) setLanguages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const heldIso3 = new Set(
    (fileSubtitleLanguages ?? []).map((code) => code.toLowerCase()),
  );
  const iso3Of = (tag: string) =>
    languages.find((language) => language.tag === tag)?.iso3.toLowerCase();
  const canReplace = (row: UploadRow) => {
    const iso3 = iso3Of(row.languageTag);
    return !row.isForced && iso3 !== undefined && heldIso3.has(iso3);
  };
  const labelOf = (language: Language) => {
    try {
      return (
        new Intl.DisplayNames([locale], { type: "language" }).of(
          language.tag,
        ) ?? language.name
      );
    } catch {
      return language.name;
    }
  };

  const update = (fileName: string, patch: Partial<UploadRow>) => {
    setRows((prev) =>
      prev.map((row) =>
        row.file.name === fileName ? { ...row, ...patch } : row,
      ),
    );
  };

  const setDefault = (fileName: string, checked: boolean) => {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        isDefault: row.file.name === fileName ? checked : false,
      })),
    );
  };

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list);
    if (inputRef.current) inputRef.current.value = "";
    setNotice(null);
    setError(null);
    const messages: string[] = [];
    let next = [...rows];
    for (const file of files) {
      const existing = next.findIndex((row) => row.file.name === file.name);
      if (existing === -1 && next.length >= MAX_FILES) {
        messages.push(tErrors("subtitleEmbed.upload_too_many"));
        continue;
      }
      let preError: string | null = null;
      if (!/\.srt$/i.test(file.name)) {
        preError = tErrors("subtitleEmbed.upload_not_srt");
      } else if (file.size > MAX_BYTES) {
        preError = tErrors("subtitleEmbed.upload_too_large");
      }
      const preset = presetFromFileName(file.name, languages);
      const row: UploadRow = {
        file,
        languageTag: preset.languageTag ?? "",
        isForced: preset.isForced,
        isDefault: false,
        replace: false,
        offset: "0",
        autoOffset: true,
        preError,
      };
      if (existing !== -1) {
        next = next.map((current, index) =>
          index === existing ? row : current,
        );
        messages.push(t("duplicateReplaced", { name: file.name }));
      } else {
        next.push(row);
      }
    }
    setRows(next);
    if (messages.length > 0) setNotice([...new Set(messages)].join(" "));
  };

  const valid =
    rows.length > 0 &&
    rows.every(
      (row) =>
        row.preError === null &&
        row.languageTag !== "" &&
        (row.autoOffset || parseOffset(row.offset) !== null),
    );

  const handleConfirm = async () => {
    setIsPending(true);
    setError(null);
    try {
      const payload: SubtitleUploadInput[] = [];
      for (const row of rows) {
        const offsetMs = row.autoOffset ? 0 : parseOffset(row.offset);
        if (offsetMs === null) return;
        const bytes = new Uint8Array(await row.file.arrayBuffer());
        payload.push({
          fileName: row.file.name,
          contentBase64: toBase64(bytes),
          languageTag: row.languageTag,
          isForced: row.isForced,
          isDefault: row.isDefault,
          replace: row.replace && canReplace(row),
          offsetMs,
          autoOffset: row.autoOffset,
        });
      }
      const result = await onUpload(payload);
      if ("error" in result) {
        if (result.errorKey && STALE_KEYS.includes(result.errorKey)) {
          onStale(result.error);
          return;
        }
        setError(result.error);
        return;
      }
      onUploaded();
    } catch {
      setError(tErrors("network.connectionFailed"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[760px] m-4">
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
          {notice && (
            <p role="status" className="text-base text-warning-500">
              {notice}
            </p>
          )}

          <input
            ref={inputRef}
            type="file"
            accept=".srt"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button
            size="sm"
            variant="outline"
            type="button"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
          >
            {t("addFiles")}
          </Button>

          {rows.map((row) => {
            const name = row.file.name;
            const replaceable = canReplace(row);
            const offsetInvalid = parseOffset(row.offset) === null;
            return (
              <div
                key={name}
                className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="block break-all font-medium text-gray-800 dark:text-white/90">
                    {name}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      setRows((prev) =>
                        prev.filter((current) => current.file.name !== name),
                      )
                    }
                  >
                    {t("remove")}
                  </Button>
                </div>
                {row.preError && (
                  <p role="alert" className="text-base text-error-500">
                    {row.preError}
                  </p>
                )}

                <div className="flex flex-wrap items-end gap-4">
                  <label className="space-y-1">
                    <span className="block text-base text-gray-600 dark:text-gray-300">
                      {t("language")}
                    </span>
                    <select
                      value={row.languageTag}
                      onChange={(e) =>
                        update(name, {
                          languageTag: e.target.value,
                          replace: false,
                        })
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="">{t("noLanguage")}</option>
                      {languages.map((language) => (
                        <option key={language.tag} value={language.tag}>
                          {labelOf(language)}
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
                      disabled={row.autoOffset}
                      onChange={(e) => update(name, { offset: e.target.value })}
                      aria-invalid={!row.autoOffset && offsetInvalid}
                      className={`${INPUT_CLASS} w-32`}
                    />
                  </label>

                  <label className="flex items-center gap-2 pb-2 text-base text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={row.autoOffset}
                      onChange={(e) =>
                        update(name, { autoOffset: e.target.checked })
                      }
                    />
                    {t("auto")}
                  </label>

                  <label className="flex items-center gap-2 pb-2 text-base text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={row.isForced}
                      onChange={(e) =>
                        update(name, {
                          isForced: e.target.checked,
                          replace: e.target.checked ? false : row.replace,
                        })
                      }
                    />
                    {t("forced")}
                  </label>

                  <label className="flex items-center gap-2 pb-2 text-base text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={row.isDefault}
                      onChange={(e) => setDefault(name, e.target.checked)}
                    />
                    {t("default")}
                  </label>

                  <label className="flex items-center gap-2 pb-2 text-base text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={row.replace && replaceable}
                      disabled={!replaceable}
                      onChange={(e) =>
                        update(name, { replace: e.target.checked })
                      }
                    />
                    {t("replace")}
                  </label>
                </div>
                {replaceable && (
                  <p className="text-base text-gray-500 dark:text-gray-400">
                    {t("replaceHint")}
                  </p>
                )}
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
