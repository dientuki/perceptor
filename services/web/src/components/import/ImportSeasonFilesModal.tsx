"use client";
import { Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type React from "react";
import { useRef, useState } from "react";
import * as tus from "tus-js-client";
import { deleteDownloadAction } from "@/actions/downloads";
import {
  createSeasonUploadTicketAction,
  finishSeasonUploadAction,
  startSeasonUploadAction,
} from "@/actions/uploads";
import Label from "@/components/form/Label";
import ReplaceWarning from "@/components/import/ReplaceWarning";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import {
  buildAcquisitionTargetLabel,
  isAcquisitionTargetCompleted,
} from "@/lib/acquisition-target";
import type { AcquisitionTarget } from "@/types/media";

type SeasonTarget = Extract<AcquisitionTarget, { kind: "season" }>;

interface ImportSeasonFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: SeasonTarget | null;
}

type FileState =
  | "queued"
  | "uploading"
  | "paused"
  | "done"
  | "error"
  | "cancelled";

interface FileRow {
  name: string;
  size: number;
  sent: number;
  state: FileState;
  error: string | null;
}

type Phase = "idle" | "running" | "paused" | "halted" | "finalizing";

interface Engine {
  files: File[];
  uploads: Map<number, tus.Upload>;
  active: Set<number>;
  retried: Set<number>;
  next: number;
  paused: boolean;
  halted: boolean;
  cancelled: boolean;
  finalized: boolean;
  mediaSourceId: number | null;
}

const CHUNK_SIZE = 8 * 1024 * 1024;
const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000];
const MAX_CONCURRENT = 4;

const ERROR_KEY_PREFIX = "error.";

const ALREADY_COMPLETED_KEY = "error.season.already_completed";
const TICKET_EXPIRED_KEY = "error.upload.ticket_expired";
const SESSION_EMPTY_KEY = "error.upload.session_empty";
const SUPERSEDED_KEY = "error.upload.superseded";

const HALTING_KEYS = new Set([
  "error.upload.ticket_wrong_source",
  "error.upload.metadata_incomplete",
  "error.upload.session_closed",
  "error.upload.session_not_found",
  "error.upload.session_not_open",
]);

interface RestErrorBody {
  message?: string;
  i18n?: {
    key?: string;
    params?: Record<string, string | number>;
  };
}

function parseRestErrorBody(raw: string | undefined): RestErrorBody | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RestErrorBody;
  } catch {
    return null;
  }
}

function readErrorBody(err: Error | tus.DetailedError): RestErrorBody | null {
  return err instanceof tus.DetailedError
    ? parseRestErrorBody(err.originalResponse?.getBody())
    : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

function createEngine(): Engine {
  return {
    files: [],
    uploads: new Map(),
    active: new Set(),
    retried: new Set(),
    next: 0,
    paused: false,
    halted: false,
    cancelled: false,
    finalized: false,
    mediaSourceId: null,
  };
}

const TERMINAL: FileState[] = ["done", "error", "cancelled"];

export default function ImportSeasonFilesModal({
  isOpen,
  onClose,
  target,
}: ImportSeasonFilesModalProps) {
  const t = useTranslations("import.season");
  const tReplace = useTranslations("import.replace");
  const tSeason = useTranslations("shows.seasonAccordion");
  const tErrors = useTranslations("errors");
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<FileRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [needsReplace, setNeedsReplace] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const engineRef = useRef<Engine>(createEngine());
  const pendingFilesRef = useRef<File[]>([]);
  const router = useRouter();

  const isCompleted = target !== null && isAcquisitionTargetCompleted(target);

  const reset = () => {
    engineRef.current = createEngine();
    pendingFilesRef.current = [];
    setPhase("idle");
    setRows([]);
    setError(null);
    setReplaceConfirmed(false);
    setNeedsReplace(false);
    setConfirmingClose(false);
  };

  const translateKey = (
    key: string | undefined,
    params?: Record<string, string | number>,
  ): string | null => {
    if (!key?.startsWith(ERROR_KEY_PREFIX)) return null;
    const path = key.slice(ERROR_KEY_PREFIX.length);
    if (!tErrors.has(path)) return null;
    try {
      return tErrors(path, params);
    } catch {
      return null;
    }
  };

  const translateUploadError = (err: Error | tus.DetailedError): string => {
    const body = readErrorBody(err);
    return (
      translateKey(body?.i18n?.key, body?.i18n?.params) ||
      body?.message ||
      err.message ||
      t("errorUpload")
    );
  };

  const updateRow = (index: number, patch: Partial<FileRow>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  const haltBatch = (message: string) => {
    const engine = engineRef.current;
    engine.halted = true;
    for (const upload of engine.uploads.values()) {
      upload.abort().catch(() => {});
    }
    setError(message);
    setPhase("halted");
    setRows((current) =>
      current.map((row) =>
        row.state === "done" || row.state === "error"
          ? row
          : { ...row, state: "cancelled" },
      ),
    );
  };

  const finalize = async (finalRows: FileRow[]) => {
    const engine = engineRef.current;
    if (engine.finalized || engine.mediaSourceId === null) return;
    engine.finalized = true;
    const mediaSourceId = engine.mediaSourceId;
    setPhase("finalizing");

    if (!finalRows.some((row) => row.state === "done")) {
      const deleted = await deleteDownloadAction(mediaSourceId);
      if (engine.cancelled) return;
      const message =
        "error" in deleted ? deleted.error : t("errorNoneUploaded");
      reset();
      setError(message);
      router.refresh();
      return;
    }

    const result = await finishSeasonUploadAction(mediaSourceId);
    if (engine.cancelled) return;
    if ("success" in result) {
      reset();
      onClose();
      router.refresh();
      return;
    }
    if (result.errorKey === SESSION_EMPTY_KEY) {
      engine.finalized = false;
      setError(result.error);
      setPhase("halted");
      return;
    }
    if (result.errorKey === SUPERSEDED_KEY) {
      engine.halted = true;
      setError(result.error);
      setPhase("halted");
      router.refresh();
      return;
    }
    engine.halted = true;
    setError(result.error);
    setPhase("halted");
  };

  const checkDone = (nextRows: FileRow[]) => {
    const engine = engineRef.current;
    if (engine.halted || engine.cancelled) return;
    if (nextRows.every((row) => TERMINAL.includes(row.state))) {
      void finalize(nextRows);
    }
  };

  const settle = (index: number, patch: Partial<FileRow>) => {
    const engine = engineRef.current;
    engine.active.delete(index);
    engine.uploads.delete(index);
    setRows((current) => {
      const nextRows = current.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      );
      queueMicrotask(() => {
        pump();
        checkDone(nextRows);
      });
      return nextRows;
    });
  };

  const buildUpload = (
    index: number,
    file: File,
    ticket: { endpoint: string; token: string },
    mediaSourceId: number,
  ): tus.Upload =>
    new tus.Upload(file, {
      endpoint: ticket.endpoint,
      chunkSize: CHUNK_SIZE,
      retryDelays: RETRY_DELAYS,
      headers: { Authorization: `Bearer ${ticket.token}` },
      metadata: {
        filename: file.name,
        mediaSourceId: String(mediaSourceId),
      },
      onProgress: (bytesSent) => updateRow(index, { sent: bytesSent }),
      onSuccess: () => settle(index, { state: "done", sent: file.size }),
      onError: (err) => {
        const engine = engineRef.current;
        if (engine.cancelled) return;
        const body = readErrorBody(err);
        const key = body?.i18n?.key;
        const message = translateUploadError(err);
        if (key === TICKET_EXPIRED_KEY && !engine.retried.has(index)) {
          engine.retried.add(index);
          void launch(index);
          return;
        }
        engine.active.delete(index);
        engine.uploads.delete(index);
        updateRow(index, { state: "error", error: message });
        if (key && HALTING_KEYS.has(key)) {
          haltBatch(message);
          return;
        }
        setRows((current) => {
          queueMicrotask(() => {
            pump();
            checkDone(current);
          });
          return current;
        });
      },
    });

  const launch = async (index: number) => {
    const engine = engineRef.current;
    const mediaSourceId = engine.mediaSourceId;
    if (mediaSourceId === null) return;
    engine.active.add(index);
    const ticketResult = await createSeasonUploadTicketAction(mediaSourceId);
    if (engine.cancelled || engine.halted) return;
    if ("error" in ticketResult) {
      engine.active.delete(index);
      updateRow(index, { state: "error", error: ticketResult.error });
      if (ticketResult.errorKey && HALTING_KEYS.has(ticketResult.errorKey)) {
        haltBatch(ticketResult.error);
      } else {
        setRows((current) => {
          queueMicrotask(() => {
            pump();
            checkDone(current);
          });
          return current;
        });
      }
      return;
    }
    const upload = buildUpload(
      index,
      engine.files[index],
      ticketResult.ticket,
      mediaSourceId,
    );
    engine.uploads.set(index, upload);
    if (engine.paused) {
      updateRow(index, { state: "paused" });
      return;
    }
    updateRow(index, { state: "uploading", error: null });
    upload.start();
  };

  const pump = () => {
    const engine = engineRef.current;
    if (engine.paused || engine.halted || engine.cancelled) return;
    while (
      engine.active.size < MAX_CONCURRENT &&
      engine.next < engine.files.length
    ) {
      const index = engine.next++;
      void launch(index);
    }
  };

  const begin = async (files: File[], force: boolean) => {
    if (!target) return;
    setError(null);
    const started = await startSeasonUploadAction(
      Number(target.season.id),
      force,
    );
    if ("error" in started) {
      if (started.errorKey === ALREADY_COMPLETED_KEY) {
        pendingFilesRef.current = files;
        setNeedsReplace(true);
        return;
      }
      setError(started.error);
      return;
    }
    const engine = createEngine();
    engine.files = files;
    engine.mediaSourceId = started.mediaSourceId;
    engineRef.current = engine;
    setNeedsReplace(false);
    setRows(
      files.map((file) => ({
        name: file.name,
        size: file.size,
        sent: 0,
        state: "queued",
        error: null,
      })),
    );
    setPhase("running");
    pump();
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    void begin(files, isCompleted && replaceConfirmed);
  };

  const handleConfirmReplace = () => {
    setReplaceConfirmed(true);
    if (needsReplace && pendingFilesRef.current.length > 0) {
      void begin(pendingFilesRef.current, true);
    }
  };

  const handlePause = () => {
    const engine = engineRef.current;
    engine.paused = true;
    for (const upload of engine.uploads.values()) {
      upload.abort().catch(() => {});
    }
    setRows((current) =>
      current.map((row) =>
        row.state === "uploading" ? { ...row, state: "paused" } : row,
      ),
    );
    setPhase("paused");
  };

  const handleResume = () => {
    const engine = engineRef.current;
    engine.paused = false;
    setPhase("running");
    setRows((current) =>
      current.map((row) =>
        row.state === "paused" ? { ...row, state: "uploading" } : row,
      ),
    );
    for (const upload of engine.uploads.values()) {
      upload.start();
    }
    pump();
  };

  const handleCancel = async () => {
    const engine = engineRef.current;
    const mediaSourceId = engine.mediaSourceId;
    engine.cancelled = true;
    for (const upload of engine.uploads.values()) {
      upload.abort(true).catch(() => {});
    }
    if (mediaSourceId !== null) {
      const deleted = await deleteDownloadAction(mediaSourceId);
      if ("error" in deleted) {
        setError(deleted.error);
        setConfirmingClose(false);
        return;
      }
    }
    reset();
    router.refresh();
  };

  const handleClose = () => {
    if (phase === "idle") {
      reset();
      onClose();
      return;
    }
    setConfirmingClose(true);
  };

  const handleConfirmedClose = async () => {
    await handleCancel();
    if (engineRef.current.mediaSourceId === null) onClose();
  };

  if (!target) return null;

  const targetLabel = buildAcquisitionTargetLabel(target, (n) =>
    tSeason("seasonLabel", { number: n }),
  );

  const totalBytes = rows.reduce((sum, row) => sum + row.size, 0);
  const sentBytes = rows.reduce((sum, row) => sum + row.sent, 0);
  const overallPercent =
    totalBytes > 0 ? Math.round((sentBytes / totalBytes) * 100) : 0;
  const doneCount = rows.filter((row) => row.state === "done").length;

  const showReplaceWarning =
    phase === "idle" && ((isCompleted && !replaceConfirmed) || needsReplace);
  const showPicker = phase === "idle" && !showReplaceWarning;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="max-w-[700px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Video className="size-6 text-blue-500" />
            {t("title")}
          </h4>
          <p className="mb-6 text-gray-500 dark:text-gray-400 lg:mb-7">
            {t.rich("description", {
              target: targetLabel,
              b: (chunks) => (
                <span className="font-medium text-gray-800 dark:text-white">
                  {chunks}
                </span>
              ),
            })}
          </p>
        </div>

        <div className="px-2">
          {showReplaceWarning && (
            <>
              <ReplaceWarning target={targetLabel} />
              <div className="flex items-center gap-3 lg:justify-end">
                <Button size="sm" type="button" onClick={handleConfirmReplace}>
                  {tReplace("confirm")}
                </Button>
              </div>
            </>
          )}

          {showPicker && (
            <>
              <Label>{t("fileLabel")}</Label>
              <input
                type="file"
                multiple
                accept="video/*,.mkv,.mp4,.avi"
                onChange={handleFilesChange}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-gray-800 shadow-theme-xs file:mr-4 file:rounded-md file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-white hover:file:bg-brand-600 dark:border-gray-700 dark:text-white/90"
              />
            </>
          )}

          {phase !== "idle" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-gray-700 dark:text-gray-300">
                  <span>
                    {t("overall", {
                      done: doneCount,
                      total: rows.length,
                      percent: overallPercent,
                    })}
                  </span>
                  <span className="shrink-0 text-gray-400">
                    {formatBytes(sentBytes)} / {formatBytes(totalBytes)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all"
                    style={{ width: `${overallPercent}%` }}
                  />
                </div>
              </div>

              <ul className="max-h-64 space-y-3 overflow-y-auto">
                {rows.map((row, index) => {
                  const percent =
                    row.size > 0 ? Math.round((row.sent / row.size) * 100) : 0;
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are fixed for the batch's lifetime
                    <li key={index} className="space-y-1">
                      <div className="flex items-center justify-between text-gray-700 dark:text-gray-300">
                        <span className="truncate">{row.name}</span>
                        <span className="shrink-0 text-gray-400">
                          {formatBytes(row.sent)} / {formatBytes(row.size)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="text-theme-sm text-gray-500 dark:text-gray-400">
                        {row.state === "queued" && t("statusQueued")}
                        {row.state === "uploading" &&
                          t("statusUploading", { percent })}
                        {row.state === "paused" && t("statusPaused")}
                        {row.state === "done" && t("statusDone")}
                        {row.state === "cancelled" && t("statusCancelled")}
                        {row.state === "error" &&
                          (row.error || t("statusErrorDefault"))}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="flex items-center justify-end gap-2">
                {phase === "running" && (
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={handlePause}
                  >
                    {t("pause")}
                  </Button>
                )}
                {phase === "paused" && (
                  <Button size="sm" type="button" onClick={handleResume}>
                    {t("resume")}
                  </Button>
                )}
                {phase !== "finalizing" && (
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={handleCancel}
                  >
                    {t("cancel")}
                  </Button>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 text-error-500 dark:text-error-400">{error}</p>
          )}

          {confirmingClose && (
            <div className="mt-4 space-y-3">
              <p className="text-gray-700 dark:text-gray-300">
                {t("confirmClose")}
              </p>
              <div className="flex items-center gap-2 lg:justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setConfirmingClose(false)}
                >
                  {t("keepUploading")}
                </Button>
                <Button size="sm" type="button" onClick={handleConfirmedClose}>
                  {t("confirmCloseYes")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={handleClose}
            type="button"
          >
            {t("close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
