"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Label from "@/components/form/Label";
import type { MediaRoot } from "@/types/media-roots";

interface PathPickerProps {
  settingKey: string;
  label: string;
  root: MediaRoot;
  value: string;
  // When true, the visible input becomes read-only — the hidden input below
  // keeps submitting `segment`'s current value regardless, so a gating
  // switch never blanks, drops or defaults the stored path to '.' (which
  // means "the media root itself" and would silently repoint the library).
  disabled?: boolean;
}

export default function PathPicker({
  settingKey,
  label,
  root,
  value,
  disabled = false,
}: PathPickerProps) {
  const t = useTranslations("settings.pathPicker");
  const [segment, setSegment] = useState(value === "." ? "" : value);

  const hostPathIsAbsolute = root.hostPath.startsWith("/");
  const prefix = root.hostPath.endsWith("/")
    ? root.hostPath
    : `${root.hostPath}/`;
  const submittedValue = segment.trim() === "" ? "." : segment.trim();

  return (
    <div>
      <Label htmlFor={`${settingKey}-input`}>{label}</Label>

      <div
        className={`flex items-stretch overflow-hidden rounded-lg border border-gray-300 shadow-theme-xs dark:border-gray-700 ${
          disabled ? "bg-gray-50 dark:bg-gray-900" : ""
        }`}
      >
        <span
          className="flex items-center whitespace-nowrap bg-gray-50 px-3 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          title={root.hostPath}
        >
          {prefix}
        </span>
        <input
          id={`${settingKey}-input`}
          type="text"
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
          readOnly={disabled}
          placeholder={t("placeholder")}
          className={`h-11 w-full min-w-0 bg-transparent px-2 focus:outline-hidden ${
            disabled
              ? "cursor-not-allowed text-gray-400 dark:text-gray-500"
              : "text-gray-800 dark:text-white/90"
          }`}
        />
      </div>

      <input type="hidden" name={settingKey} value={submittedValue} />

      {!hostPathIsAbsolute && (
        <p className="mt-1.5 text-theme-sm text-gray-500">
          {t("relativeHint")}
        </p>
      )}

      {!root.available && (
        <p className="mt-1.5 text-base text-error-500">{t("notMountedHint")}</p>
      )}
    </div>
  );
}
