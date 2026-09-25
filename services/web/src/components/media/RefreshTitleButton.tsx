"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import Button from "@/components/ui/button/Button";
import type { TitleRefreshResult } from "@/types/media";

interface RefreshTitleButtonProps {
  onRefresh: () => Promise<TitleRefreshResult>;
}

export default function RefreshTitleButton({
  onRefresh,
}: RefreshTitleButtonProps) {
  const t = useTranslations("media.refreshTitle");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<
    TitleRefreshResult,
    { success: true }
  > | null>(null);

  function handleClick() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await onRefresh();
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setResult(res);
      router.refresh();
    });
  }

  const failures: string[] = [];
  const parts: string[] = [];
  if (result) {
    if (result.catalog === "FAILED") failures.push(t("catalogFailed"));
    if (result.mediaServer === "FAILED") failures.push(t("mediaServerFailed"));
    if (failures.length === 0) parts.push(t("done"));
    if (result.promoted > 0)
      parts.push(t("promoted", { count: result.promoted }));
    if (result.demoted > 0) parts.push(t("demoted", { count: result.demoted }));
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handleClick}
        disabled={pending}
      >
        <RefreshCw size={18} className={pending ? "animate-spin" : ""} />
        {t("button")}
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-error-500">
          {error}
        </p>
      )}
      {result && (
        <p className="w-full text-sm text-gray-500 dark:text-gray-400">
          {failures.length > 0 && (
            <span className="text-warning-500">{failures.join(". ")}. </span>
          )}
          {parts.join(". ")}
        </p>
      )}
    </>
  );
}
