"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import Label from "@/components/form/Label";
import { Magnet } from "lucide-react";
import { importMagnetAction } from "@/actions/imports";
import type { Movie } from "@/actions/movies";
import type { Episode, MediaType } from "@/types/media";

interface ImportMagnetModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: Movie | Episode | null;
  mediaType: MediaType;
}

const CONFLICT_MESSAGE = "ya tiene una descarga en curso";

export default function ImportMagnetModal({ isOpen, onClose, item }: ImportMagnetModalProps) {
  const [magnet, setMagnet] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const router = useRouter();

  // Limpiar todo cuando cambia el item o se reabre el modal.
  useEffect(() => {
    if (isOpen) {
      setMagnet("");
      setError(null);
      setNeedsConfirm(false);
    }
  }, [isOpen, item]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !magnet.trim()) return;

    setIsPending(true);
    setError(null);

    try {
      await importMagnetAction(Number(item.id), magnet, needsConfirm);
      onClose();
      // Mismo criterio que ImportFileModal/SearchTorrent: refrescar el server
      // component para que la película aparezca con su estado nuevo.
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error al importar el magnet.";
      setError(message);
      setNeedsConfirm(message.includes(CONFLICT_MESSAGE));
    } finally {
      setIsPending(false);
    }
  };

  if (!item) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[700px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Magnet className="size-6 text-red-500" />
            Importar Magnet
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400 lg:mb-7">
            Ingresá el magnet link para{" "}
            <span className="font-medium text-gray-800 dark:text-white">
              {"title" in item ? item.title : `Episodio ${item.episodeNumber}`}
            </span>
            .
          </p>
        </div>
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <div className="px-2 overflow-y-auto custom-scrollbar">
            <Label>Magnet</Label>
            <input
              type="text"
              value={magnet}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setMagnet(e.target.value);
                setError(null);
                setNeedsConfirm(false);
              }}
              placeholder="magnet:?xt=urn:btih:da39a3ee..."
              autoFocus
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />
            {error && <p className="mt-2 text-sm text-error-500">{error}</p>}
          </div>
          <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
            <Button size="sm" variant="outline" onClick={onClose} type="button">
              Cancelar
            </Button>
            <Button size="sm" type="submit" disabled={isPending || !magnet.trim()}>
              {isPending ? "Procesando..." : needsConfirm ? "Reemplazar" : "Confirmar"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
