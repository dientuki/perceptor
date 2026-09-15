"use client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import type { ContentKind } from "@/types/media";
import { CONTENT_KINDS } from "@/types/media";

// Shared by both detail pages (Movie.tsx, Show.tsx) — a title's content kind
// is a property of the title itself, never a per-media-type concept, so this
// lives beside MediaCard.tsx rather than under movies/ or shows/.
//
// `Select` accepts a controlled `value`, unlike the short toggle's `Switch`
// (which owns its own display state and needs a remount key to revert) — so
// reverting on a server refusal here is just setting local state back, no
// remount trick needed.
export default function ContentKindSelect({
  value,
  onSave,
  label,
}: {
  value: ContentKind;
  onSave: (kind: ContentKind) => Promise<{ error: string } | { success: true }>;
  label: string;
}) {
  const t = useTranslations();
  const [selected, setSelected] = useState<ContentKind>(value);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const options = CONTENT_KINDS.map((kind) => ({
    value: kind,
    label: t(`contentKind.${kind}`),
  }));

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as ContentKind;
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
      <Label htmlFor="content-kind">{label}</Label>
      <div className="max-w-xs">
        <Select
          id="content-kind"
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
