"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { startLibraryTagMigrationAction } from "@/actions/library-tags";
import Label from "@/components/form/Label";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { useDateMonthFirst } from "@/context/DateFormatContext";
import { formatDateTime } from "@/lib/format";
import { translateErrorKey } from "@/lib/graphql-error";
import type { LibraryTagMigration } from "@/types/library-tags";

interface LibraryTagMigrationBlockProps {
  migration: LibraryTagMigration | null;
}

const ERROR_CLASS =
  "text-base text-error-500 bg-error-50 dark:bg-error-500/10 p-3 rounded-lg";
const MIGRATION_RUNNING_KEY = "error.libraryTags.migration_running";

// Spec 123, REQ-12 REQ-18 REQ-19
export default function LibraryTagMigrationBlock({
  migration,
}: LibraryTagMigrationBlockProps) {
  const t = useTranslations("settings.environment.libraryTags");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const monthFirst = useDateMonthFirst();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const running = migration?.status === "RUNNING";
  const finished = migration?.status === "COMPLETED";

  const stamp = (iso: string | null) =>
    iso && mounted ? formatDateTime(iso, monthFirst) : "";

  const handleConfirm = async () => {
    setIsPending(true);
    setError(null);

    try {
      const result = await startLibraryTagMigrationAction();

      if ("error" in result) {
        setError(result.error);
        if (result.errorKey === MIGRATION_RUNNING_KEY) {
          router.refresh();
        }
        setConfirmOpen(false);
        return;
      }

      setConfirmOpen(false);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  };

  const counts = migration
    ? ([
        ["migrated", migration.migrated, "success"],
        ["unchanged", migration.unchanged, "light"],
        ["busy", migration.busy, "warning"],
        ["missing", migration.missing, "warning"],
        ["failed", migration.failed, "error"],
      ] as const)
    : [];

  return (
    <div className="space-y-3">
      <Label>{t("label")}</Label>
      <p className="text-gray-700 dark:text-gray-300">{t("description")}</p>

      {migration && (
        <div className="space-y-2 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
          {running && (
            <div className="flex flex-wrap items-center gap-3">
              <Badge color="info">{t("running")}</Badge>
              <span className="text-gray-700 dark:text-gray-300">
                {t("progress", {
                  processed: migration.processed,
                  total: migration.total,
                })}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.refresh()}
              >
                {t("refresh")}
              </Button>
            </div>
          )}
          {finished && (
            <div className="text-gray-700 dark:text-gray-300">
              {t("finishedAt", { date: stamp(migration.finishedAt) })}
            </div>
          )}
          <div className="text-gray-500 dark:text-gray-400">
            {t("startedAt", { date: stamp(migration.startedAt) })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {counts.map(([key, value, color]) => (
              <Badge key={key} color={color}>
                {t(`counts.${key}`, { count: value })}
              </Badge>
            ))}
          </div>
          {finished && migration.failures.length > 0 && (
            <div className="space-y-1">
              <div className="font-medium text-gray-800 dark:text-white/90">
                {t("failuresTitle")}
              </div>
              <ul className="space-y-1">
                {migration.failures.map((failure) => (
                  <li
                    key={`${failure.path}:${failure.reasonKey}`}
                    className="text-gray-700 dark:text-gray-300"
                  >
                    <code className="break-all">{failure.path}</code>
                    {": "}
                    {translateErrorKey(
                      tErrors,
                      failure.reasonKey,
                      undefined,
                      t("failureGeneric"),
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className={ERROR_CLASS}>{error}</p>}

      <div>
        <Button
          size="sm"
          disabled={running || isPending}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          {t("start")}
        </Button>
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        className="max-w-[500px] m-4"
      >
        <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
          <div className="px-2 pr-14">
            <h4 className="mb-6 text-2xl font-semibold text-gray-800 dark:text-white/90">
              {t("confirmTitle")}
            </h4>
          </div>
          <div className="px-2">
            <p className="text-gray-600 dark:text-gray-300">
              {t("confirmMessage")}
            </p>
          </div>
          <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setConfirmOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              size="sm"
              type="button"
              disabled={isPending}
              onClick={handleConfirm}
            >
              {isPending ? t("starting") : t("confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
