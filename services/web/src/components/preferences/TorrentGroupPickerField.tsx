"use client";

import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import Badge from "@/components/ui/badge/Badge";
import type { TorrentGroup } from "@/types/preferences";

interface TorrentGroupPickerFieldProps {
  options: TorrentGroup[];
  value: string[];
  onChange: (ids: string[]) => void;
  label: string;
  disabled?: boolean;
}

// Controlled sibling of TorrentGroupPicker.tsx — same pick-and-badge visual,
// no <form>, no action and no save button of its own, because REQ-8's
// single Guardar button owns the submit here rather than each field.
export default function TorrentGroupPickerField({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: TorrentGroupPickerFieldProps) {
  const t = useTranslations("preferences.torrentGroups");

  const groupById = useMemo(() => {
    const map = new Map<string, TorrentGroup>();
    for (const option of options) {
      map.set(option.id, option);
    }
    return map;
  }, [options]);

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.name.localeCompare(b.name)),
    [options],
  );

  const chosen = value
    .map((id) => groupById.get(id))
    .filter((group): group is TorrentGroup => group != null);

  const toggle = (id: string) => {
    if (disabled) return;
    onChange(
      value.includes(id)
        ? value.filter((existing) => existing !== id)
        : [...value, id],
    );
  };

  const remove = (id: string) => {
    if (disabled) return;
    onChange(value.filter((existing) => existing !== id));
  };

  return (
    <div>
      <div className="mb-1.5 block font-medium text-gray-700 dark:text-gray-400">
        {label}
      </div>

      <div className="max-h-52 w-full overflow-y-auto rounded-lg border border-gray-300 bg-transparent p-2 shadow-theme-xs dark:border-gray-700 dark:bg-gray-900">
        <div className="space-y-0.5">
          {sortedOptions.map((option) => {
            const isSelected = value.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(option.id)}
                disabled={disabled}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  isSelected
                    ? "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                }`}
              >
                <span>{option.name}</span>
                {isSelected && <Check size={16} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 block text-gray-700 dark:text-gray-400">
          {t("chosenLabel")}
        </div>
        {chosen.length === 0 ? (
          <p className="text-gray-500">{t("emptyChosen")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {chosen.map((group) => (
              <Badge
                key={group.id}
                color="primary"
                endIcon={
                  <button
                    type="button"
                    aria-label={t("removeGroup", { name: group.name })}
                    onClick={() => remove(group.id)}
                    className="inline-flex"
                  >
                    <X size={14} />
                  </button>
                }
              >
                {group.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
