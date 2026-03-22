"use client";
import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { Video } from "lucide-react";
import { createManualJobAction } from "@/actions/jobs";

interface ImportFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: any;
}

export default function ImportFileModal({ isOpen, onClose, item }: ImportFileModalProps) {
  const [path, setPath] = useState("");
  const [isPending, setIsPending] = useState(false);

  // Limpiar input cuando cambia el item o se cierra
  useEffect(() => {
    if (isOpen) setPath("");
  }, [isOpen, item]);
  
  const title = "Importar Video Local";
  const label = "Path Absoluto";
  const placeholder = "/home/user/downloads/video.mkv";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    setIsPending(true);
    
    // TODO: Manejar la lógica específica para Magnet si es diferente en el futuro
    // Por ahora usamos la misma acción para el path del video
    const result = await createManualJobAction(item.tmdbId || item.id, path);
    
    setIsPending(false);
    
    if (result.success) {
      onClose();
    } else {
      alert(result.message);
    }
  };

  if (!item) return null;

  console.log(item)

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[700px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Video className="size-6 text-blue-500" />
            {title}
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400 lg:mb-7">
            Ingresa el path absoluto del archivo para{" "}
            <span className="font-medium text-gray-800 dark:text-white">{item.title || item.name || `Item ${item.id}`}</span>.
          </p>
        </div>
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <div className="px-2 overflow-y-auto custom-scrollbar">
            <Label>{label}</Label>
            <Input 
              type="text" 
              value={path} 
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPath(e.target.value)} 
              placeholder={placeholder} 
              autoFocus
            />
          </div>
          <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
            <Button size="sm" variant="outline" onClick={onClose} type="button">
              Cancelar
            </Button>
            <Button size="sm" onClick={() => {}} type="submit" disabled={isPending}>
              {isPending ? "Procesando..." : "Confirmar"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}