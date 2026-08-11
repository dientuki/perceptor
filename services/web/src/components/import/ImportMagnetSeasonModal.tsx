"use client";
import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { Magnet } from "lucide-react";
import { createJobFromSeasonMagnetAction } from "@/actions/jobs";

interface ImportMagnetSeasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  showId: number;
  seasonId: number;
  showTitle: string;
  seasonNumber: number;
}

export default function ImportMagnetSeasonModal({ 
  isOpen, onClose, showId, seasonId, showTitle, seasonNumber 
}: ImportMagnetSeasonModalProps) {
  const [magnet, setMagnet] = useState("");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (isOpen) setMagnet("");
  }, [isOpen]);
  
  const title = "Importar Magnet Temporada";
  const label = "Link Magnet";
  const placeholder = "magnet:?xt=urn:btih:...";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!magnet.trim()) return;

    setIsPending(true);
    const result = await createJobFromSeasonMagnetAction(showId, seasonId, [magnet]);
    setIsPending(false);
    
    if (result.success) {
      onClose();
    } else {
      alert(result.message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-[700px] m-4">
      <div className="relative w-full p-4 overflow-y-auto bg-white no-scrollbar rounded-3xl dark:bg-gray-900 lg:p-11">
        <div className="px-2 pr-14">
          <h4 className="mb-2 text-2xl font-semibold text-gray-800 dark:text-white/90 flex items-center gap-2">
            <Magnet className="size-6 text-red-500" />
            {title}
          </h4>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400 lg:mb-7">
            Ingresa el magnet link para la temporada {seasonNumber} de{" "}
            <span className="font-medium text-gray-800 dark:text-white">{showTitle}</span>.
          </p>
        </div>
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <div className="px-2">
            <Label>{label}</Label>
            <Input 
              type="text" 
              value={magnet} 
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMagnet(e.target.value)} 
              placeholder={placeholder} 
              autoFocus
            />
          </div>
          <div className="flex items-center gap-3 px-2 mt-6 lg:justify-end">
            <Button size="sm" variant="outline" onClick={onClose} type="button">Cancelar</Button>
            <Button size="sm" type="submit" disabled={isPending || !magnet}>
              {isPending ? "Procesando..." : "Confirmar Pack"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}