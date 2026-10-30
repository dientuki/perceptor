"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setMovieAutoAcquireAction } from "@/actions/movies";
import { setShowAutoAcquireAction } from "@/actions/shows";
import Switch from "@/components/form/switch/Switch";

interface AutoAcquireSwitchProps {
  kind: "movie" | "show";
  id: string;
  initial: boolean;
}

// Spec 109, REQ-15
export default function AutoAcquireSwitch({
  kind,
  id,
  initial,
}: AutoAcquireSwitchProps) {
  const t = useTranslations("media.autoAcquire");
  const [value, setValue] = useState(initial);
  const [switchKey, setSwitchKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Switch owns its display state (defaultChecked), so a refusal reverts it
  // by remounting with the last confirmed value.
  const handleToggle = (checked: boolean) => {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "movie"
          ? await setMovieAutoAcquireAction(id, checked)
          : await setShowAutoAcquireAction(id, checked);
      if ("error" in result) {
        setError(result.error);
        setSwitchKey((key) => key + 1);
        return;
      }
      setValue(checked);
    });
  };

  return (
    <div className="mt-4 space-y-1">
      <Switch
        key={switchKey}
        label={t("label")}
        defaultChecked={value}
        disabled={isPending}
        onChange={handleToggle}
      />
      <p className="text-xs text-gray-500 dark:text-gray-400">{t("hint")}</p>
      {error && <p className="text-error-500">{error}</p>}
    </div>
  );
}
