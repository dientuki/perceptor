"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Radio from "@/components/form/input/Radio";
import Switch from "@/components/form/switch/Switch";

const RESOLUTIONS = ["4k", "1080p", "720p", "360p"] as const;
type Resolution = (typeof RESOLUTIONS)[number];
const DEFAULT_RESOLUTION: Resolution = "1080p";

interface CompressionPanelProps {
  compressionEnabled: boolean;
  compressionResolution: string;
}

// Compresión tab: the switch persists `compression_enabled` through the main
// Settings form's Save button, via the hidden input below. The resolution
// radios persist `compression_resolution` the same way — no `name` on the
// radios themselves (see the comment below), a hidden input carries the
// selected value instead. They are disabled whenever the switch is off.
export default function CompressionPanel({
  compressionEnabled,
  compressionResolution,
}: CompressionPanelProps) {
  const t = useTranslations("settings.compression");
  const [enabled, setEnabled] = useState(compressionEnabled);
  const [resolution, setResolution] = useState<Resolution>(
    RESOLUTIONS.includes(compressionResolution as Resolution)
      ? (compressionResolution as Resolution)
      : DEFAULT_RESOLUTION,
  );

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
          {t("resolutionLabel")}
        </p>
        <div className="flex flex-col gap-3">
          {RESOLUTIONS.map((value) => (
            <Radio
              key={value}
              id={`compression-resolution-${value}`}
              // Empty name, deliberately: a non-empty `name` on a form
              // control makes it a "successful control" the browser
              // includes in FormData on submit (WHATWG "constructing the
              // form data set"), which REQ-4 forbids. Exclusivity across
              // the group is enforced by the shared `resolution` state and
              // `checked`/`onChange` below, not by native radio grouping.
              name=""
              value={value}
              checked={resolution === value}
              label={t(`resolutions.${value}`)}
              onChange={(v) => setResolution(v as Resolution)}
              disabled={!enabled}
            />
          ))}
        </div>
        <input type="hidden" name="compression_resolution" value={resolution} />
      </div>
    </div>
  );
}
