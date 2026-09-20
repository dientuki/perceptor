"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import RemoveTitleModal from "@/components/media/RemoveTitleModal";
import Button from "@/components/ui/button/Button";
import { useModal } from "@/hooks/useModal";
import type { TitleRemovalResult } from "@/types/media";

interface RemoveTitleButtonProps {
  title: string;
  otherOwners: number;
  hasLibraryFile: boolean;
  redirectTo: string;
  onConfirm: () => Promise<TitleRemovalResult>;
}

// Client-side owner of the modal state, so the server-rendered Show page can
// mount it too.
export default function RemoveTitleButton(props: RemoveTitleButtonProps) {
  const t = useTranslations("media.removeTitle");
  const { isOpen, openModal, closeModal } = useModal();

  return (
    <>
      <Button size="sm" variant="outline" onClick={openModal}>
        <Trash2 size={18} className="text-error-500" />
        {t("button")}
      </Button>
      <RemoveTitleModal isOpen={isOpen} onClose={closeModal} {...props} />
    </>
  );
}
