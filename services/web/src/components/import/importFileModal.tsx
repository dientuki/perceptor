"use client";
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import Label from "@/components/form/Label";
import { Video } from "lucide-react";
import type { AcquisitionTarget } from "@/types/media";
import { createUploadTicketAction } from "@/actions/uploads";

interface ImportFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: AcquisitionTarget | null;
}

type UploadStatus = "idle" | "uploading" | "paused" | "error" | "done";

// tus-js-client no acepta re-arrancar con abort(true) (eso termina la subida
// del todo); pausar es simplemente dejar de mandar chunks y reanudar es
// volver a llamar start() sobre la misma instancia — retoma solo desde el
// Upload-Offset que ya tiene el server (ver services/api/src/uploads/).
const CHUNK_SIZE = 8 * 1024 * 1024;
const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000];

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

export default function ImportFileModal({ isOpen, onClose, target }: ImportFileModalProps) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const router = useRouter();

  const title = "Importar Video Local";

  const reset = () => {
    uploadRef.current = null;
    setStatus("idle");
    setFileName(null);
    setProgress({ sent: 0, total: 0 });
    setError(null);
  };

  const handleClose = () => {
    // Pausa (no termina) una subida en curso: cerrar el modal no debe tirar
    // el progreso ya subido, el usuario puede reabrir y seguir después.
    uploadRef.current?.abort();
    reset();
    onClose();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !target) return;

    setError(null);
    setFileName(file.name);
    setProgress({ sent: 0, total: file.size });
    setStatus("uploading");

    // El ticket se pide antes de crear la subida: onUploadCreate lo verifica
    // una sola vez, en el POST inicial (ver spec 002-auth-login).
    let ticket;
    try {
      ticket = await createUploadTicketAction(target);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Error al generar el permiso de subida.");
      return;
    }

    // El metadata key movieId mantiene su nombre y significado exactos aun
    // para un film (NFR-1); episodeId es la contraparte para un episodio.
    const targetMetadata: Record<string, string> = {};
    if (target.kind === "movie") {
      targetMetadata.movieId = String(target.movie.id);
    } else {
      targetMetadata.episodeId = String(target.episode.id);
    }

    const upload = new tus.Upload(file, {
      endpoint: ticket.endpoint,
      chunkSize: CHUNK_SIZE,
      retryDelays: RETRY_DELAYS,
      headers: {
        Authorization: 'Bearer ' + ticket.token,
      },
      metadata: {
        filename: file.name,
        ...targetMetadata,
      },
      onProgress: (bytesSent, bytesTotal) => setProgress({ sent: bytesSent, total: bytesTotal }),
      onSuccess: () => {
        setStatus("done");
        onClose();
        // Mismo criterio que SearchTorrent: refrescar el server component
        // para que la película aparezca con su estado nuevo.
        router.refresh();
      },
      onError: (err) => {
        setStatus("error");
        setError(err.message || "Error al subir el archivo.");
      },
    });

    uploadRef.current = upload;
    upload.start();
  };

  const handlePause = () => {
    uploadRef.current?.abort();
    setStatus("paused");
  };

  const handleResume = () => {
    setStatus("uploading");
    setError(null);
    uploadRef.current?.start();
  };

  const handleCancel = () => {
    // true = le avisa al server que borre lo subido hasta ahora (DELETE), a
    // diferencia de abort() en handleClose/handlePause.
    uploadRef.current?.abort(true).catch(() => {});
    reset();
  };

  if (!target) return null;

  const percent = progress.total > 0 ? Math.round((progress.sent / progress.total) * 100) : 0;

  const targetLabel =
    target.kind === "movie"
      ? target.movie.title
      : `${target.showTitle} S${String(target.seasonNumber).padStart(2, "0")}E${String(target.episode.episodeNumber).padStart(2, "0")}`;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} className="max-w-[700px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Video className="size-6 text-blue-500" />
            {title}
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400 lg:mb-7">
            Elegí el archivo de video para{" "}
            <span className="font-medium text-gray-800 dark:text-white">{targetLabel}</span>.
            {" "}Se sube por la red — podés pausarlo y reanudarlo si se corta.
          </p>
        </div>

        <div className="px-2">
          {status === "idle" && (
            <>
              <Label>Archivo</Label>
              <input
                type="file"
                accept="video/*,.mkv,.mp4,.avi"
                onChange={handleFileChange}
                className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs file:mr-4 file:rounded-md file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-white file:text-sm hover:file:bg-brand-600 dark:border-gray-700 dark:text-white/90"
              />
            </>
          )}

          {status !== "idle" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300">
                <span className="truncate">{fileName}</span>
                <span className="shrink-0 text-gray-400">
                  {formatBytes(progress.sent)} / {formatBytes(progress.total)}
                </span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {status === "uploading" && `Subiendo… ${percent}%`}
                  {status === "paused" && "Pausado"}
                  {status === "error" && (error || "Error al subir")}
                  {status === "done" && "Completado"}
                </span>

                <div className="flex gap-2">
                  {status === "uploading" && (
                    <Button size="sm" variant="outline" type="button" onClick={handlePause}>
                      Pausar
                    </Button>
                  )}
                  {(status === "paused" || status === "error") && (
                    <Button size="sm" type="button" onClick={handleResume}>
                      Reanudar
                    </Button>
                  )}
                  {status !== "done" && (
                    <Button size="sm" variant="outline" type="button" onClick={handleCancel}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
          <Button size="sm" variant="outline" onClick={handleClose} type="button">
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
