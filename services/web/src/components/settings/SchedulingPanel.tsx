"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { runScheduledTaskAction } from "@/actions/scheduler";
import Switch from "@/components/form/switch/Switch";
import Button from "@/components/ui/button/Button";
import type { ScheduledTask } from "@/types/scheduler";

interface SchedulingPanelProps {
  tasks: ScheduledTask[];
}

// One row per registered task, following MediaServerFields.tsx's
// MediaServerIndexPanel: useTransition + @/components/ui/button/Button for
// "Ejecutar ahora", never a nested <form> (invalid HTML) and never a raw
// <button> (defaults to type="submit", which would submit SettingsForm's
// main form). The enable switch saves through the main form's Guardar, like
// every other setting — same Switch + hidden-input idiom as
// CompressionPanel.tsx. The cron expression is not user-editable (it is set
// once and reported, never a form field), so last run / next run take the
// grid cell it would have used.
function TaskRow({ task }: { task: ScheduledTask }) {
  const t = useTranslations("settings.scheduling");
  const activeLocale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(task);
  const [enabled, setEnabled] = useState(task.enabled);
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
  const isUnavailable = !current.available;

  const handleRun = () => {
    setError(null);
    startTransition(async () => {
      const result = await runScheduledTaskAction(current.id);
      if ("error" in result) {
        if (result.errorKey === "error.schedule.task_already_running") {
          setCurrent((prev) => ({ ...prev, running: true }));
          return;
        }
        if (result.errorKey === "error.schedule.task_unavailable") {
          setCurrent((prev) => ({ ...prev, available: false }));
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
          disabled={isRunning || isUnavailable}
          onClick={handleRun}
        >
          {isRunning ? t("running") : t("runButton")}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Switch
            label={t("enabledLabel")}
            defaultChecked={current.enabled}
            disabled={isUnavailable}
            onChange={setEnabled}
          />
          {isUnavailable && (
            <p className="mt-1 text-error-500">{t("unavailableReason")}</p>
          )}
          {/* Always emits the task's stored value, even while unavailable —
              dropping this or forcing "false" would silently disable the
              task for good the next time any setting is saved (REQ-9). */}
          <input
            type="hidden"
            name={`schedule_${current.id}_enabled`}
            value={enabled ? "true" : "false"}
          />
        </div>

        <div className="flex flex-wrap gap-6 text-gray-500 dark:text-gray-400">
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
