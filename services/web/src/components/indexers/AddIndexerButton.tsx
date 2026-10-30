"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import AddIndexerModal from "@/components/indexers/AddIndexerModal";
import Button from "@/components/ui/button/Button";

interface AddIndexerButtonProps {
  onAdded?: () => void;
}

// Spec 112, REQ-13 REQ-14
export default function AddIndexerButton({ onAdded }: AddIndexerButtonProps) {
  const t = useTranslations("indexers");
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const handleAdded = () => {
    router.refresh();
    onAdded?.();
  };

  return (
    <>
      <Button
        size="sm"
        startIcon={<Plus size={16} />}
        onClick={() => setIsOpen(true)}
      >
        {t("add")}
      </Button>
      <AddIndexerModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onAdded={handleAdded}
      />
    </>
  );
}
