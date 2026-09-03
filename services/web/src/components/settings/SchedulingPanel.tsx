"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { runScheduledTaskAction } from "@/actions/scheduler";
import Label from "@/components/form/Label";
import CheckboxField from "@/components/settings/CheckboxField";
import Button from "@/components/ui/button/Button";
import type { ScheduledTask } from "@/types/scheduler";

interface SchedulingPanelProps {
  tasks: ScheduledTask[];
}

// One row per registered task, following MediaServerFields.tsx's
// MediaServerIndexPanel: useTransition + @/components/ui/button/Button for
// "Ejecutar ahora", never a nested <form> (invalid HTML) and never a raw
// <button> (defaults to type="submit", which would submit SettingsForm's
// main form). The enable checkbox and cron input are ordinary form fields —
// they save through the main form's Guardar, like every other setting.
function TaskRow({ task }: { task: ScheduledTask }) {
  const t = useTranslations("settings.scheduling");
  const activeLocale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(task);
  const [error, setError] = useState<string | null>(null);
  // toLocaleString() renders differently during SSR (container timezone)
  // than in the browser (the viewer's own) — deferring to after mount avoids
  // a hydration mismatch, same as MediaServerIndexPanel's syncedAt.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const taskLabel = t.has(`tasks.${current.id}.label`)
    ? t(`tasks.${current.id}.label`)
    : current.id;
  const taskDescription = t.has(`tasks.${current.id}.description`)
    ? t(`tasks.${current.id}.description`)
    : null;

  const isRunning = current.running || isPending;

  const handleRun = () => {
    setError(null);
    startTransition(async () => {
      const result = await runScheduledTaskAction(current.id);
      if ("error" in result) {
        if (result.errorKey === "error.schedule.task_already_running") {
          setCurrent((prev) => ({ ...prev, running: true }));
          return;
        }
        setError(result.error || t("runErrorDefault"));
        return;
      }
      setCurrent(result.task);
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-medium text-gray-800 dark:text-white/90">
            {taskLabel}
          </p>
          {taskDescription && (
            <p className="text-gray-500 dark:text-gray-400">
              {taskDescription}
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isRunning}
          onClick={handleRun}
        >
          {isRunning ? t("running") : t("runButton")}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CheckboxField
          name={`schedule_${current.id}_enabled`}
          label={t("enabledLabel")}
          defaultChecked={current.enabled}
        />

        <div>
          <Label htmlFor={`schedule_${current.id}_cron`}>
            {t("cronLabel")}
          </Label>
          <input
            id={`schedule_${current.id}_cron`}
            name={`schedule_${current.id}_cron`}
            type="text"
            defaultValue={current.cron}
            className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-6 text-gray-500 dark:text-gray-400">
        <div>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {t("lastRunLabel")}
          </p>
          {current.lastRun ? (
            <p>
              {t.has(`outcome.${current.lastRun.outcome}`)
                ? t(`outcome.${current.lastRun.outcome}`)
                : current.lastRun.outcome}
              {" — "}
              {mounted
                ? new Date(current.lastRun.startedAt).toLocaleString(
                    activeLocale,
                  )
                : ""}
              {current.lastRun.outcome === "SUCCESS" && (
                <>
                  {" · "}
                  {t("itemsProcessed", {
                    count: current.lastRun.itemsProcessed,
                  })}
                </>
              )}
              {current.lastRun.outcome === "FAILED" &&
                current.lastRun.error && (
                  <span className="block text-error-500">
                    {current.lastRun.error}
                  </span>
                )}
            </p>
          ) : (
            <p>{t("lastRunNever")}</p>
          )}
        </div>

        <div>
          <p className="font-medium text-gray-700 dark:text-gray-300">
            {t("nextRunLabel")}
          </p>
          <p>
            {current.nextRunAt
              ? mounted
                ? new Date(current.nextRunAt).toLocaleString(activeLocale)
                : ""
              : t("nextRunNone")}
          </p>
        </div>
      </div>

      {error && <p className="mt-3 text-error-500">{error}</p>}
    </div>
  );
}

export default function SchedulingPanel({ tasks }: SchedulingPanelProps) {
  const t = useTranslations("settings.scheduling");

  return (
    <div className="space-y-6">
      <p className="text-gray-500 dark:text-gray-400">{t("timezoneNote")}</p>

      <div className="space-y-4">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
