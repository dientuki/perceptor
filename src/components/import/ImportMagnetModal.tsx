"use client";
import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { Video } from "lucide-react";
import { createJobFromMagnetAction } from "@/actions/jobs";
import { MediaType } from "@prisma/client";

interface ImportMagnetModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: any;
  mediaType: MediaType;
}

export default function ImportMagnetModal({ isOpen, onClose, item, mediaType }: ImportMagnetModalProps) {
  const [path, setPath] = useState("");
  const [isPending, setIsPending] = useState(false);

  // Limpiar input cuando cambia el item o se cierra
  useEffect(() => {
    if (isOpen) setPath("");
  }, [isOpen, item]);
  
  const title = "Importar Magnet";
  const label = "URL";
  const placeholder = "magnet:?xt=urn:btih:da39a3ee...";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;

    setIsPending(true);
    console.log(item);
    const result = await createJobFromMagnetAction(item, path, mediaType);
    setIsPending(false);
    
    if (result.success) {
      onClose();
    } else {
      alert(result.message);
    }
  };

  if (!item) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[700px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Video className="size-6 text-blue-500" />
            {title}
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400 lg:mb-7">
            Ingresa la url del magnet torrent para{" "}
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