"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Checkbox from "@/components/form/input/Checkbox";
import Radio from "@/components/form/input/Radio";

const PRESETS = ["fast", "balanced", "quality"] as const;
type Preset = (typeof PRESETS)[number];
const DEFAULT_PRESET: Preset = "balanced";

// Compresión tab (REQ-9): markup only. Local useState, no `name`, no hidden
// input — nothing here reaches FormData, adds no key to the settings
// catalog, and changes no FFmpeg argument. What it will control is a later
// spec's decision.
export default function CompressionPanel() {
  const t = useTranslations("settings.compression");
  const [enabled, setEnabled] = useState(false);
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);

  return (
    <div className="space-y-6">
      <Checkbox
        id="compression-enabled"
        checked={enabled}
        onChange={setEnabled}
        label={t("enabledLabel")}
      />

      <div>
        <p className="mb-2 font-medium text-gray-700 dark:text-gray-400">
          {t("presetLabel")}
        </p>
        <div className="flex flex-col gap-3">
          {PRESETS.map((value) => (
            <Radio
              key={value}
              id={`compression-preset-${value}`}
              // Empty name, deliberately: a non-empty `name` on a form
              // control makes it a "successful control" the browser
              // includes in FormData on submit (WHATWG "constructing the
              // form data set"), which REQ-9 forbids. Exclusivity across
              // the group is enforced by the shared `preset` state and
              // `checked`/`onChange` below, not by native radio grouping.
              name=""
              value={value}
              checked={preset === value}
              label={t(`presets.${value}`)}
              onChange={(v) => setPreset(v as Preset)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
