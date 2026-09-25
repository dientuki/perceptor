"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Checkbox from "@/components/form/input/Checkbox";
import Radio from "@/components/form/input/Radio";
import Switch from "@/components/form/switch/Switch";

const RESOLUTIONS = ["4k", "1080p", "720p", "480p", "360p"] as const;
type Resolution = (typeof RESOLUTIONS)[number];
const DEFAULT_RESOLUTION: Resolution = "1080p";

const TEXT_FORMATS = [
  { id: "srt", label: "SRT" },
  { id: "ass", label: "ASS / SSA" },
  { id: "webvtt", label: "WebVTT" },
  { id: "mov_text", label: "MP4 text" },
] as const;
const IMAGE_FORMATS = [
  { id: "pgs", label: "PGS (Blu-ray)" },
  { id: "vobsub", label: "VobSub (DVD)" },
  { id: "dvb", label: "DVB" },
] as const;

function parseFormats(
  raw: string,
  catalog: readonly { id: string }[],
): Set<string> {
  const known = new Set(catalog.map((format) => format.id));
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => known.has(id)),
  );
}

function serializeFormats(
  selected: Set<string>,
  catalog: readonly { id: string }[],
): string {
  return catalog
    .filter((format) => selected.has(format.id))
    .map((format) => format.id)
    .join(",");
}

function toggleFormat(selected: Set<string>, id: string, on: boolean) {
  const next = new Set(selected);
  if (on) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

interface CompressionPanelProps {
  compressionEnabled: boolean;
  compressionResolution: string;
  subtitlesEnabled: boolean;
  subtitlesTextEnabled: boolean;
  subtitlesTextFormats: string;
  subtitlesImageEnabled: boolean;
  subtitlesImageFormats: string;
}

// Compresión tab: the switch persists `compression_enabled` through the main
// Settings form's Save button, via the hidden input below. The resolution
// radios persist `compression_resolution` the same way — no `name` on the
// radios themselves (see the comment below), a hidden input carries the
// selected value instead. They are disabled whenever the switch is off.
export default function CompressionPanel({
  compressionEnabled,
  compressionResolution,
  subtitlesEnabled,
  subtitlesTextEnabled,
  subtitlesTextFormats,
  subtitlesImageEnabled,
  subtitlesImageFormats,
}: CompressionPanelProps) {
  const t = useTranslations("settings.compression");
  const [enabled, setEnabled] = useState(compressionEnabled);
  const [resolution, setResolution] = useState<Resolution>(
    RESOLUTIONS.includes(compressionResolution as Resolution)
      ? (compressionResolution as Resolution)
      : DEFAULT_RESOLUTION,
  );

  const [noSubtitles, setNoSubtitles] = useState(!subtitlesEnabled);
  const [textEnabled, setTextEnabled] = useState(subtitlesTextEnabled);
  const [imageEnabled, setImageEnabled] = useState(subtitlesImageEnabled);
  const [textFormats, setTextFormats] = useState(() =>
    parseFormats(subtitlesTextFormats, TEXT_FORMATS),
  );
  const [imageFormats, setImageFormats] = useState(() =>
    parseFormats(subtitlesImageFormats, IMAGE_FORMATS),
  );

  const sectionOn = enabled && !noSubtitles;
  const textFormatsOn = sectionOn && textEnabled;
  const imageFormatsOn = sectionOn && imageEnabled;

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

      <div>
        <p
          className={`mb-2 font-medium ${
            enabled
              ? "text-gray-700 dark:text-gray-400"
              : "text-gray-300 dark:text-gray-600"
          }`}
        >
          {t("subtitles.label")}
        </p>
        <div className="flex flex-col gap-3">
          <Checkbox
            id="compression-subtitles-none"
            label={t("subtitles.none")}
            checked={noSubtitles}
            onChange={setNoSubtitles}
            disabled={!enabled}
          />
          <Checkbox
            id="compression-subtitles-text"
            label={t("subtitles.allowText")}
            checked={textEnabled}
            onChange={setTextEnabled}
            disabled={!sectionOn}
          />
          <div className="ml-8 flex flex-col gap-3">
            {TEXT_FORMATS.map((format) => (
              <Checkbox
                key={format.id}
                id={`compression-subtitles-text-${format.id}`}
                label={format.label}
                checked={textFormats.has(format.id)}
                onChange={(on) =>
                  setTextFormats((prev) => toggleFormat(prev, format.id, on))
                }
                disabled={!textFormatsOn}
              />
            ))}
          </div>
          <Checkbox
            id="compression-subtitles-image"
            label={t("subtitles.allowImage")}
            checked={imageEnabled}
            onChange={setImageEnabled}
            disabled={!sectionOn}
          />
          <div className="ml-8 flex flex-col gap-3">
            {IMAGE_FORMATS.map((format) => (
              <Checkbox
                key={format.id}
                id={`compression-subtitles-image-${format.id}`}
                label={format.label}
                checked={imageFormats.has(format.id)}
                onChange={(on) =>
                  setImageFormats((prev) => toggleFormat(prev, format.id, on))
                }
                disabled={!imageFormatsOn}
              />
            ))}
          </div>
        </div>
        <input
          type="hidden"
          name="subtitles_enabled"
          value={noSubtitles ? "false" : "true"}
        />
        <input
          type="hidden"
          name="subtitles_text_enabled"
          value={textEnabled ? "true" : "false"}
        />
        <input
          type="hidden"
          name="subtitles_text_formats"
          value={serializeFormats(textFormats, TEXT_FORMATS)}
        />
        <input
          type="hidden"
          name="subtitles_image_enabled"
          value={imageEnabled ? "true" : "false"}
        />
        <input
          type="hidden"
          name="subtitles_image_formats"
          value={serializeFormats(imageFormats, IMAGE_FORMATS)}
        />
      </div>
    </div>
  );
}
