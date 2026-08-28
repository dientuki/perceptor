"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Radio from "@/components/form/input/Radio";
import Switch from "@/components/form/switch/Switch";

const PRESETS = ["fast", "balanced", "quality"] as const;
type Preset = (typeof PRESETS)[number];
const DEFAULT_PRESET: Preset = "balanced";

interface CompressionPanelProps {
  compressionEnabled: boolean;
}

// Compresión tab: the switch persists `compression_enabled` through the main
// Settings form's Save button, via the hidden input below. The preset radios
// remain local state — no `name`, no catalog key, no effect on any FFmpeg
// argument — and are disabled whenever the switch is off.
export default function CompressionPanel({
  compressionEnabled,
}: CompressionPanelProps) {
  const t = useTranslations("settings.compression");
  const [enabled, setEnabled] = useState(compressionEnabled);
  const [preset, setPreset] = useState<Preset>(DEFAULT_PRESET);

  return (
    <div className="space-y-6">
      <div>
        <Switch
          label={t("enabledLabel")}
          defaultChecked={compressionEnabled}
          onChange={setEnabled}
        />
        <input
          type="hidden"
          name="compression_enabled"
          value={enabled ? "true" : "false"}
        />
      </div>

      <div>
        <p
          className={`mb-2 font-medium ${
            enabled
              ? "text-gray-700 dark:text-gray-400"
              : "text-gray-300 dark:text-gray-600"
          }`}
        >
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
              // form data set"), which REQ-4 forbids. Exclusivity across
              // the group is enforced by the shared `preset` state and
              // `checked`/`onChange` below, not by native radio grouping.
              name=""
              value={value}
              checked={preset === value}
              label={t(`presets.${value}`)}
              onChange={(v) => setPreset(v as Preset)}
              disabled={!enabled}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
