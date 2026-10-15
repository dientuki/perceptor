"use client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import type { GrainMode } from "@/types/media";
import { GRAIN_MODES } from "@/types/media";

// Shared by both detail pages (Movie.tsx, Show.tsx), clone of
// ContentKindSelect.tsx — see that file's own comment for why this control
// does not use the shorts `Switch`'s key-remount-on-refusal trick: `Select`
// takes a controlled `value`, so reverting on a refusal is just setting
// state back to the previous value.
export default function GrainModeSelect({
  value,
  onSave,
  label,
}: {
  value: GrainMode;
  onSave: (mode: GrainMode) => Promise<{ error: string } | { success: true }>;
  label: string;
}) {
  const t = useTranslations();
  const [selected, setSelected] = useState<GrainMode>(value);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const options = GRAIN_MODES.map((mode) => ({
    value: mode,
    label: t(`grainMode.${mode}`),
  }));

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as GrainMode;
    const previous = selected;
    setError(null);
    setSelected(next);
    startTransition(async () => {
      const result = await onSave(next);
      if ("error" in result) {
        setError(result.error);
        setSelected(previous);
      }
    });
  };

  return (
    <div className="space-y-1">
      <Label htmlFor="grain-mode">{label}</Label>
      <div className="max-w-xs">
        <Select
          id="grain-mode"
          value={selected}
          options={options}
          onChange={handleChange}
          disabled={isPending}
        />
      </div>
      {error && <p className="text-error-500">{error}</p>}
    </div>
  );
}
