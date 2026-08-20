"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Label from "@/components/form/Label";
import type { MediaRoot } from "@/types/media-roots";

interface PathPickerProps {
  settingKey: string;
  label: string;
  root: MediaRoot;
  // Valor guardado, relativo a la raíz ('.' significa "la raíz misma").
  value: string;
}

// La ruta de container nunca se muestra ni se tipea acá — sólo la raíz del
// lado del host (root.hostPath, la que el usuario configuró en .env al
// instalar) más el segmento que el usuario elige. El input visible no lleva
// `name`: lo que viaja en el FormData es el hidden de abajo, que traduce
// "vacío" a "." antes de que updateSettingsAction (actions/settings.ts) lo
// vea — así ese filtro de blancos no descarta "quiero la raíz misma".
export default function PathPicker({
  settingKey,
  label,
  root,
  value,
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

      <div className="flex items-stretch overflow-hidden rounded-lg border border-gray-300 shadow-theme-xs dark:border-gray-700">
        <span
          className="flex items-center whitespace-nowrap bg-gray-50 px-3 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400"
          title={root.hostPath}
        >
          {prefix}
        </span>
        <input
          id={`${settingKey}-input`}
          type="text"
          value={segment}
          onChange={(e) => setSegment(e.target.value)}
          placeholder={t("placeholder")}
          className="h-11 w-full min-w-0 bg-transparent px-2 text-sm text-gray-800 focus:outline-hidden dark:text-white/90"
        />
      </div>

      <input type="hidden" name={settingKey} value={submittedValue} />

      {!hostPathIsAbsolute && (
        <p className="mt-1.5 text-xs text-gray-500">{t("relativeHint")}</p>
      )}

      {!root.available && (
        <p className="mt-1.5 text-xs text-error-500">{t("notMountedHint")}</p>
      )}
    </div>
  );
}
