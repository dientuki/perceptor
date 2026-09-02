"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import Checkbox from "@/components/form/input/Checkbox";
import LanguagePickerField from "@/components/preferences/LanguagePickerField";
import Button from "@/components/ui/button/Button";
import type { Language } from "@/types/languages";

type LanguageAction = (
  prevState: unknown,
  formData: FormData,
) => Promise<{ error?: string } | { success: true }>;

type AudioMandatoryAction = (
  mandatory: boolean,
) => Promise<{ error: string } | { success: true }>;

function tagsFrom(languages: Language[]): string[] {
  return languages.map((language) => language.tag);
}

interface TitleLanguagesFormProps {
  options: Language[];
  audioSelected: Language[];
  subtitleSelected: Language[];
  audioMandatory: boolean;
  setAudioAction: LanguageAction;
  setSubtitleAction: LanguageAction;
  setAudioMandatoryAction: AudioMandatoryAction;
}

// Two LanguagePickerField panes, side by side, under one Guardar (REQ-1) —
// the same submit shape PreferencesForm.tsx already established for its
// downloadLanguages tab, applied here to a single title's own audio and
// subtitle preferences instead of the user's general ones. The Audio
// mandatory checkbox (REQ-8) rides the same submit as a third action,
// rendered inside the audio pane under its badge list.
export default function TitleLanguagesForm({
  options,
  audioSelected,
  subtitleSelected,
  audioMandatory,
  setAudioAction,
  setSubtitleAction,
  setAudioMandatoryAction,
}: TitleLanguagesFormProps) {
  const t = useTranslations("media.languagePicker");
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const [audioTags, setAudioTags] = useState<string[]>(() =>
    tagsFrom(audioSelected),
  );
  const [subtitleTags, setSubtitleTags] = useState<string[]>(() =>
    tagsFrom(subtitleSelected),
  );
  const [mandatory, setMandatory] = useState(audioMandatory);

  const handleSubmit = () => {
    setErrors([]);
    setSaved(false);

    startTransition(async () => {
      const audioForm = new FormData();
      audioForm.set("tags", audioTags.join(","));
      const subtitleForm = new FormData();
      subtitleForm.set("tags", subtitleTags.join(","));

      const [audioResult, subtitleResult, audioMandatoryResult] =
        await Promise.all([
          setAudioAction(null, audioForm),
          setSubtitleAction(null, subtitleForm),
          setAudioMandatoryAction(mandatory),
        ]);

      const newErrors: string[] = [];
      if (audioResult && "error" in audioResult && audioResult.error) {
        newErrors.push(audioResult.error);
        setAudioTags(tagsFrom(audioSelected));
      }
      if (
        subtitleResult &&
        "error" in subtitleResult &&
        subtitleResult.error
      ) {
        newErrors.push(subtitleResult.error);
        setSubtitleTags(tagsFrom(subtitleSelected));
      }
      if (
        audioMandatoryResult &&
        "error" in audioMandatoryResult &&
        audioMandatoryResult.error
      ) {
        newErrors.push(audioMandatoryResult.error);
        setMandatory(audioMandatory);
      }

      setErrors(newErrors);
      setSaved(newErrors.length === 0);
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <LanguagePickerField
            options={options}
            value={audioTags}
            onChange={setAudioTags}
            label={t("audioLabel")}
          />
          <Checkbox
            id="title-audio-mandatory"
            checked={mandatory}
            onChange={setMandatory}
            label={t("audioMandatoryLabel")}
          />
        </div>
        <LanguagePickerField
          options={options}
          value={subtitleTags}
          onChange={setSubtitleTags}
          label={t("subtitleLabel")}
        />
      </div>

      {errors.length > 0 && (
        <div className="space-y-1 rounded-lg bg-error-50 p-3 dark:bg-error-500/10">
          {errors.map((message) => (
            <p key={message} className="text-error-500">
              {message}
            </p>
          ))}
        </div>
      )}

      {saved && <p className="text-success-500">{t("saved")}</p>}

      <div>
        <Button size="sm" disabled={isPending} onClick={handleSubmit}>
          {isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
